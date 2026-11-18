import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sessionForCwd, statusFromEvent, normaliseHookEvent, createLiveStore, restartPhase } from '../lib/live.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-live-'));
const repo = path.join(tmp, 'acme');
const other = path.join(tmp, 'beta');
const PROJECTS = [{ index: 0, repoFolder: repo }, { index: 1, repoFolder: other }];

test('a lane worktree folder maps to its lane', () => {
  assert.deepEqual(sessionForCwd(path.join(repo, '.claude', 'worktrees', 'lane-b'), PROJECTS), { project: 0, key: 'lane-b' });
  assert.deepEqual(sessionForCwd(path.join(repo, '.claude', 'worktrees', 'LANE-C', 'src', 'app'), PROJECTS), { project: 0, key: 'lane-c' });
  assert.deepEqual(sessionForCwd(path.join(other, '.claude', 'worktrees', 'lane-infra'), PROJECTS), { project: 1, key: 'lane-infra' });
  // The deepest lane folder wins.
  assert.deepEqual(sessionForCwd(path.join(repo, 'lane-a', 'nested', 'lane-d'), PROJECTS), { project: 0, key: 'lane-d' });
});

test('a lane folder outside every repo needs a single project', () => {
  const outside = path.join(tmp, 'acme-lane-b');
  assert.equal(sessionForCwd(outside, PROJECTS), null);
  assert.deepEqual(sessionForCwd(outside, [{ index: 0, repoFolder: repo }]), { project: 0, key: 'lane-b' });
  assert.deepEqual(sessionForCwd(outside, [{ index: 0, repoFolder: null }]), { project: 0, key: 'lane-b' });
});

test('the repo folder itself is the coordinator; anything else is unknown', () => {
  assert.deepEqual(sessionForCwd(repo, PROJECTS), { project: 0, key: 'coordinator' });
  assert.deepEqual(sessionForCwd(path.join(repo, 'src'), PROJECTS), { project: 0, key: 'coordinator' });
  assert.equal(sessionForCwd(`${repo}-old`, PROJECTS), null);
  assert.equal(sessionForCwd(path.join(tmp, 'lanes-dashboard'), PROJECTS), null);
  assert.equal(sessionForCwd(path.join(repo, 'lane-b-notes'), PROJECTS).key, 'coordinator');
  assert.equal(sessionForCwd('', PROJECTS), null);
  assert.equal(sessionForCwd(undefined, PROJECTS), null);
  if (process.platform === 'win32') assert.deepEqual(sessionForCwd(repo.toUpperCase(), PROJECTS), { project: 0, key: 'coordinator' });
});

test('hook events map to a status', () => {
  const s = (o) => statusFromEvent(normaliseHookEvent({ session_id: 's1', ...o }))?.status ?? null;
  assert.equal(s({ hook_event_name: 'UserPromptSubmit' }), 'working');
  assert.equal(s({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }), 'working');
  assert.equal(s({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', error: 'exit 1' }), 'error');
  assert.equal(s({ hook_event_name: 'PostToolUseFailure', is_interrupt: true }), 'idle');
  assert.equal(s({ hook_event_name: 'StopFailure', error: 'rate limit' }), 'error');
  assert.equal(s({ hook_event_name: 'Stop' }), 'idle');
  assert.equal(s({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }), 'waiting');
  assert.equal(s({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }), 'waiting');
  assert.equal(s({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), 'idle');
  assert.equal(s({ hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
  assert.equal(s({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Edit' }), 'waiting');
  assert.equal(s({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }), 'ended');
  assert.equal(s({ hook_event_name: 'PreCompact' }), null);
});

test('bad events are refused', () => {
  assert.equal(normaliseHookEvent(null), 'Bad request');
  assert.equal(normaliseHookEvent([]), 'Bad request');
  assert.equal(normaliseHookEvent({ hook_event_name: 'Stop' }), 'Bad session_id');
  assert.equal(normaliseHookEvent({ session_id: 'a b', hook_event_name: 'Stop' }), 'Bad session_id');
  assert.equal(normaliseHookEvent({ session_id: 'a', hook_event_name: 'Stop!' }), 'Bad hook_event_name');
  assert.equal(normaliseHookEvent({ session_id: 'a', hook_event_name: 'Stop', cwd: 5 }), 'Bad cwd');
  const long = normaliseHookEvent({ session_id: 'a', hook_event_name: 'Notification', message: 'x'.repeat(5000) });
  assert.equal(long.message.length, 300);
});

test('the store keeps "since" while the status stays the same', () => {
  let t = Date.parse('2026-11-18T10:00:00Z');
  const store = createLiveStore({ projects: PROJECTS, now: () => t });
  const lane = path.join(repo, '.claude', 'worktrees', 'lane-a');
  const post = (o) => store.handle({ session_id: 's1', cwd: lane, ...o });
  post({ hook_event_name: 'UserPromptSubmit' });
  const start = t;
  t += 30_000;
  const r = post({ hook_event_name: 'PostToolUse', tool_name: 'Read' });
  assert.equal(r.record.status, 'working');
  assert.equal(r.record.since, start);
  t += 30_000;
  assert.equal(post({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }).changed, true);
  assert.equal(store.forProject(0).byKey['lane-a'].status, 'waiting');
  assert.equal(store.forProject(0).byKey['lane-a'].since, t);
  // A subagent's tool call does not end the wait.
  t += 1000;
  assert.equal(post({ hook_event_name: 'PostToolUse', agent_id: 'sub1' }).changed, false);
  assert.equal(store.forProject(0).byKey['lane-a'].status, 'waiting');
  t += 1000;
  post({ hook_event_name: 'Stop' });
  assert.equal(store.forProject(0).byKey['lane-a'].status, 'idle');
  assert.deepEqual(store.forProject(1).byKey, {});
  // Ended sessions drop out of the view.
  post({ hook_event_name: 'SessionEnd' });
  assert.equal(store.forProject(0).byKey['lane-a'], undefined);
});

test('the newest session wins a lane; unknown folders show as other', () => {
  let t = Date.parse('2026-11-18T10:00:00Z');
  const store = createLiveStore({ projects: PROJECTS, now: () => t });
  const lane = path.join(repo, '.claude', 'worktrees', 'lane-b');
  store.handle({ session_id: 'old', cwd: lane, hook_event_name: 'Stop' });
  t += 5000;
  store.handle({ session_id: 'new', cwd: lane, hook_event_name: 'UserPromptSubmit' });
  store.handle({ session_id: 'x', cwd: path.join(tmp, 'scratch'), hook_event_name: 'UserPromptSubmit' });
  const v = store.forProject(0);
  assert.equal(v.byKey['lane-b'].sessionId, 'new');
  assert.equal(v.other.length, 1);
  assert.equal(v.other[0].folder, 'scratch');
  // Sessions quiet for over 12 hours are forgotten.
  t += 13 * 60 * 60 * 1000;
  assert.deepEqual(store.forProject(0), { byKey: {}, other: [], restart: {} });
});

test('events are appended to the log file', () => {
  const logFile = path.join(tmp, 'unit-logs', 'sessions.jsonl');
  const store = createLiveStore({ projects: PROJECTS, logFile });
  store.handle({ session_id: 's9', cwd: repo, hook_event_name: 'Stop' });
  store.handle({ session_id: 's9', cwd: repo, hook_event_name: 'UserPromptSubmit' });
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.event, l.lane, l.status]), [['Stop', 'coordinator', 'idle'], ['UserPromptSubmit', 'coordinator', 'working']]);
});

// ---------- the endpoint, on a real server ----------
const PORT = 4390 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  const lanes = path.join(tmp, 'lanes');
  fs.mkdirSync(lanes, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(lanes, 'lane-a.md'), 'Updated: now\nNow: testing\n');
  fs.writeFileSync(path.join(lanes, 'coordinator.md'), 'Now: watching\n');
  fs.writeFileSync(path.join(lanes, 'lane-d.md'), 'Updated: now\nState: Handing off\nNow: handing off\n');
  const config = path.join(tmp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ port: PORT, showModels: false, projects: [{ name: 'acme', lanesFolder: lanes, repoFolder: repo, prStateFile: path.join(ROOT, 'examples', 'pr-states.json') }] }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, LANES_CONFIG: config, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
    server.stdout.on('data', (d) => { if (String(d).includes('Lanes dashboard:')) { clearTimeout(timer); resolve(); } });
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(() => {
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const postEvent = (body, headers = {}) => fetch(`${BASE}/api/session-event`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('POST /api/session-event updates the state and the event stream', async () => {
  const ctrl = new AbortController();
  const stream = await fetch(`${BASE}/events?p=0`, { signal: ctrl.signal });
  const reader = stream.body.getReader();
  let seen = '';
  const waitFor = async (re) => {
    const end = Date.now() + 5000;
    while (!re.test(seen)) {
      if (Date.now() > end) throw new Error(`no ${re} in the stream`);
      const { value } = await reader.read();
      seen += new TextDecoder().decode(value);
    }
  };
  await waitFor(/event: state/);
  seen = '';

  const r = await postEvent({ session_id: 'e2e-1', cwd: path.join(repo, '.claude', 'worktrees', 'lane-a'), hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, lane: 'lane-a', status: 'waiting' });
  await waitFor(/"waiting"/);
  ctrl.abort();

  const st = await (await fetch(`${BASE}/api/state?p=0`)).json();
  assert.equal(st.live.byKey['lane-a'].status, 'waiting');
  assert.equal(st.live.byKey['lane-a'].detail, 'Claude needs your permission to use Bash');

  const c = await postEvent({ session_id: 'e2e-2', cwd: repo, hook_event_name: 'UserPromptSubmit' });
  assert.equal(c.status, 200);
  assert.deepEqual(await c.json(), { ok: true, lane: 'coordinator', status: 'working' });
});

test('a handed-off lane turns Restarting, then Starting up, on the event stream', async () => {
  const cwd = path.join(repo, '.claude', 'worktrees', 'lane-d');
  const ctrl = new AbortController();
  const reader = (await fetch(`${BASE}/events?p=0`, { signal: ctrl.signal })).body.getReader();
  let seen = '';
  const waitFor = async (re) => {
    const end = Date.now() + 5000;
    while (!re.test(seen)) {
      if (Date.now() > end) throw new Error(`no ${re} in the stream`);
      const { value } = await reader.read();
      seen += new TextDecoder().decode(value);
    }
  };
  await waitFor(/event: state/);
  seen = '';
  await postEvent({ session_id: 'd-old', cwd, hook_event_name: 'SessionEnd', reason: 'other' });
  await waitFor(/"restart":\{"lane-d":"restarting"\}/);
  seen = '';
  await postEvent({ session_id: 'd-new', cwd, hook_event_name: 'SessionStart', source: 'startup' });
  await waitFor(/"restart":\{"lane-d":"starting"\}/);
  ctrl.abort();
});

test('POST /api/session-event refuses bad input and other hosts', async () => {
  assert.equal((await postEvent('not json')).status, 400);
  assert.equal((await postEvent({ hook_event_name: 'Stop' })).status, 400);
  assert.equal((await postEvent({ session_id: 'a', hook_event_name: 'Stop', message: 'x'.repeat(70 * 1024) })).status, 413);
  assert.equal((await postEvent({ session_id: 'a', hook_event_name: 'Stop' }, { Origin: 'http://evil.example' })).status, 403);
  const plain = await fetch(`${BASE}/api/session-event`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
});

test('the hook script posts the event and exits 0', async () => {
  const input = JSON.stringify({ session_id: 'hook-1', transcript_path: 'x', cwd: path.join(repo, '.claude', 'worktrees', 'lane-c'), hook_event_name: 'Stop', prompt: 'never sent' });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lane-hook.mjs')], { input, env: { ...process.env, LANES_HOOK_URL: `${BASE}/api/session-event` }, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  const st = await (await fetch(`${BASE}/api/state?p=0`)).json();
  assert.equal(st.live.byKey['lane-c'].status, 'idle');
  const log = fs.readFileSync(path.join(tmp, 'logs', 'sessions.jsonl'), 'utf8');
  assert.ok(!log.includes('never sent'), 'the prompt text is never sent');
});

test('the hook script exits 0 fast and silently when the dashboard is down or the input is junk', () => {
  for (const input of ['{"session_id":"h","hook_event_name":"Stop"}', 'not json', '']) {
    const started = Date.now();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lane-hook.mjs')], { input, env: { ...process.env, LANES_HOOK_URL: 'http://127.0.0.1:9/api/session-event' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
    assert.ok(Date.now() - started < 3000, 'exits within its time budget');
  }
});

test('an event that fired before the latest one changes nothing', () => {
  const t = Date.parse('2026-11-18T10:00:00Z');
  const store = createLiveStore({ projects: PROJECTS, now: () => t });
  const cwd = path.join(repo, '.claude', 'worktrees', 'lane-a');
  store.handle({ session_id: 's1', cwd, hook_event_name: 'Stop', ts: new Date(t - 1000).toISOString() });
  const late = store.handle({ session_id: 's1', cwd, hook_event_name: 'PostToolUse', ts: new Date(t - 3000).toISOString() });
  assert.equal(late.changed, false);
  assert.equal(store.forProject(0).byKey['lane-a'].status, 'idle');
  // A hook clock ahead of ours, or far behind, is replaced by ours.
  const r = store.handle({ session_id: 's2', cwd, hook_event_name: 'Stop', ts: new Date(t + 60_000).toISOString() });
  assert.equal(r.record.since, t);
});

test('a handed-off lane shows Restarting when its session ends, Starting up when a new one runs', () => {
  let t = Date.parse('2026-11-18T10:00:00Z');
  const store = createLiveStore({ projects: PROJECTS, now: () => t });
  const cwd = path.join(repo, '.claude', 'worktrees', 'lane-c');
  const post = (id, o) => store.handle({ session_id: id, cwd, ...o });
  post('old', { hook_event_name: 'UserPromptSubmit' });
  t += 60_000;
  const boards = { 'lane-c': { state: 'handoff', mtime: t } }; // the old session writes "Handing off"
  t += 1000;
  post('old', { hook_event_name: 'Stop' });
  assert.deepEqual(store.forProject(0, boards).restart, {}, 'old session still open: Needs restart');
  t += 5000;
  assert.equal(post('old', { hook_event_name: 'SessionEnd', reason: 'other' }).changed, true);
  assert.deepEqual(store.forProject(0, boards).restart, { 'lane-c': 'restarting' });
  // Stopped reads the same; other board states and other projects are untouched.
  assert.deepEqual(store.forProject(0, { 'lane-c': { state: 'stopped', mtime: boards['lane-c'].mtime } }).restart, { 'lane-c': 'restarting' });
  assert.deepEqual(store.forProject(0, { 'lane-c': { state: 'working', mtime: boards['lane-c'].mtime } }).restart, {});
  assert.deepEqual(store.forProject(1, boards).restart, {});
  // Ended sessions are kept past the old 10 minute cut, so the card does not fall back to red.
  t += 30 * 60 * 1000;
  assert.deepEqual(store.forProject(0, boards).restart, { 'lane-c': 'restarting' });
  t += 1000;
  assert.equal(post('new', { hook_event_name: 'SessionStart', source: 'startup' }).changed, true);
  const v = store.forProject(0, boards);
  assert.deepEqual(v.restart, { 'lane-c': 'starting' });
  assert.equal(v.byKey['lane-c'].sessionId, 'new');
  // A late event from the old session does not make it the newest again.
  post('old', { hook_event_name: 'Notification', notification_type: 'idle_prompt' });
  assert.deepEqual(store.forProject(0, boards).restart, { 'lane-c': 'starting' });
  // The new session rewrites the board: normal rules apply, even if it still says Handing off.
  t += 1000;
  assert.deepEqual(store.forProject(0, { 'lane-c': { state: 'working', mtime: t } }).restart, {});
  assert.deepEqual(store.forProject(0, { 'lane-c': { state: 'handoff', mtime: t } }).restart, {});
});

test('restartPhase reads the board against the newest session', () => {
  const board = { state: 'handoff', mtime: 1000 };
  assert.equal(restartPhase(board, null), null);
  assert.equal(restartPhase(null, { status: 'ended', first: 1 }), null);
  assert.equal(restartPhase(board, { status: 'ended', first: 500 }), 'restarting');
  assert.equal(restartPhase(board, { status: 'idle', first: 500 }), null);
  assert.equal(restartPhase(board, { status: 'working', first: 1500 }), 'starting');
  assert.equal(restartPhase({ state: 'handoff', mtime: null }, { status: 'idle', first: 1500 }), null);
});
