// Live session status from Claude Code hooks. scripts/lane-hook.mjs posts one
// small event per hook; this file turns events into a status per session and
// maps each session to a lane by its working folder. No file system access
// except the optional append-only log, so the logic is easy to test.
import fs from 'node:fs';
import path from 'node:path';

// working: a prompt was sent or a tool ran. waiting: a permission prompt or a
// question needs the person. idle: the turn finished. error: a tool failed or
// the turn ended on an API error. ended: the session closed.
export const LIVE_STATES = ['working', 'waiting', 'idle', 'error', 'ended'];

// Notification types that mean the session is stuck until the person answers.
const NEEDS_INPUT = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
const MAX_TEXT = 300;
const KEEP_MS = 12 * 60 * 60 * 1000; // forget sessions quiet for 12 hours
const KEEP_ENDED_MS = 10 * 60 * 1000; // and ended ones after 10 minutes
const MAX_SESSIONS = 200;
const LOG_MAX_BYTES = 1024 * 1024;

const clip = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');

// The status an event moves a session to, with a short reason, or null when the
// event says nothing about the status (auth notices, unknown events).
export function statusFromEvent(ev) {
  switch (ev.event) {
    case 'UserPromptSubmit': return { status: 'working', detail: 'Prompt sent' };
    case 'PostToolUse': return { status: 'working', detail: ev.tool ? `Ran ${ev.tool}` : 'Ran a tool' };
    case 'PostToolUseFailure':
      if (ev.isInterrupt) return { status: 'idle', detail: 'Interrupted' };
      return { status: 'error', detail: [ev.tool ? `${ev.tool} failed` : 'A tool failed', ev.error].filter(Boolean).join(': ') };
    case 'StopFailure': return { status: 'error', detail: ['Turn ended on an error', ev.error || ev.reason].filter(Boolean).join(': ') };
    case 'Stop': return { status: 'idle', detail: 'Turn finished' };
    case 'SessionStart': return { status: 'idle', detail: ev.source ? `Session ${ev.source}` : 'Session started' };
    case 'SessionEnd': return { status: 'ended', detail: ev.reason ? `Ended (${ev.reason})` : 'Ended' };
    case 'Notification': {
      if (NEEDS_INPUT.has(ev.notificationType)) return { status: 'waiting', detail: ev.message || 'Needs your input' };
      if (ev.notificationType === 'idle_prompt') return { status: 'idle', detail: ev.message || 'Waiting for your next prompt' };
      // Older versions send no type: read the message.
      if (!ev.notificationType && /permission|needs your|waiting for your input|approve/i.test(ev.message)) return { status: 'waiting', detail: ev.message };
      return null;
    }
    default: return null;
  }
}

// Check and trim a posted event. Returns the event, or a string saying what is wrong.
export function normaliseHookEvent(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Bad request';
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!/^[\w.:-]{1,100}$/.test(sessionId)) return 'Bad session_id';
  const event = typeof body.hook_event_name === 'string' ? body.hook_event_name.trim() : '';
  if (!/^[A-Za-z]{1,40}$/.test(event)) return 'Bad hook_event_name';
  if (body.cwd != null && (typeof body.cwd !== 'string' || body.cwd.length > 1000)) return 'Bad cwd';
  const t = Date.parse(body.ts);
  return {
    sessionId,
    event,
    cwd: typeof body.cwd === 'string' ? body.cwd : '',
    // The hook stamps the time it fired. Trust it up to 10 minutes back (a slow delivery), never ahead of our clock.
    t: Number.isFinite(t) && t <= now + 5000 && t >= now - 600_000 ? Math.min(t, now) : now,
    notificationType: clip(body.notification_type),
    message: clip(body.message),
    error: clip(body.error),
    reason: clip(body.reason),
    source: clip(body.source),
    tool: clip(body.tool_name).slice(0, 60),
    isInterrupt: body.is_interrupt === true,
    subagent: typeof body.agent_id === 'string' && body.agent_id.length > 0,
  };
}

const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '');
const caseFold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const inside = (child, parent) => {
  const c = caseFold(norm(child));
  const pr = caseFold(norm(parent));
  return c === pr || c.startsWith(`${pr}/`);
};

// Which lane a working folder belongs to. A folder named lane-<id> (for example
// <repo>/.claude/worktrees/lane-b, or ~/code/acme-lane-b) is that lane; the
// deepest such folder wins. Otherwise a folder inside a project's repoFolder is
// that project's coordinator. Returns { project, key } or null when unknown.
// projects: [{ index, repoFolder }].
export function sessionForCwd(cwd, projects) {
  if (typeof cwd !== 'string' || !cwd.trim()) return null;
  const full = norm(cwd);
  const parts = full.split('/');
  let lane = null;
  for (const part of parts) {
    const m = part.match(/(?:^|[-_.])lane-([a-z0-9]{1,12})$/i);
    if (m) lane = m[1].toLowerCase();
  }
  const owner = projects.filter((p) => p.repoFolder && inside(full, p.repoFolder))
    .sort((a, b) => norm(b.repoFolder).length - norm(a.repoFolder).length)[0];
  if (lane) {
    const project = owner ? owner.index : projects.length === 1 ? projects[0].index : null;
    return project == null ? null : { project, key: `lane-${lane}` };
  }
  return owner ? { project: owner.index, key: 'coordinator' } : null;
}

// The status store. One record per session id, the latest status first.
export function createLiveStore({ projects, logFile = null, now = () => Date.now() } = {}) {
  const sessions = new Map();
  let logOk = !!logFile;
  if (logOk) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_MAX_BYTES) fs.renameSync(logFile, `${logFile}.1`);
    } catch { logOk = false; }
  }
  const log = (line) => {
    if (!logOk) return;
    try { fs.appendFileSync(logFile, `${JSON.stringify(line)}\n`); } catch { logOk = false; }
  };

  function prune() {
    const n = now();
    for (const [id, r] of sessions) {
      if (n - r.at > KEEP_MS || (r.status === 'ended' && n - r.at > KEEP_ENDED_MS)) sessions.delete(id);
    }
    if (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((a, b) => a.at - b.at).slice(0, sessions.size - MAX_SESSIONS);
      for (const r of oldest) sessions.delete(r.sessionId);
    }
  }

  // Apply one posted event. Returns { status, error } or { status: 200, record, changed }.
  function handle(body) {
    const ev = normaliseHookEvent(body, now());
    if (typeof ev === 'string') return { status: 400, error: ev };
    const next = statusFromEvent(ev);
    const prev = sessions.get(ev.sessionId);
    const where = sessionForCwd(ev.cwd, projects);
    log({ ts: new Date(ev.t).toISOString(), session: ev.sessionId, event: ev.event, type: ev.notificationType || undefined, cwd: ev.cwd, lane: where ? where.key : 'other', status: next ? next.status : undefined });
    // A subagent's tool call after the turn finished does not make the session busy again, and an
    // event that fired before the latest one (async hooks can arrive out of order) changes nothing.
    const ignore = !next || (prev && ev.t < prev.at) || (ev.subagent && prev && (prev.status === 'idle' || prev.status === 'waiting'));
    if (ignore && prev) { prev.at = Math.max(prev.at, ev.t); return { status: 200, record: prev, changed: false }; }
    if (ignore) return { status: 200, record: null, changed: false };
    const same = prev && prev.status === next.status;
    const record = {
      sessionId: ev.sessionId,
      cwd: ev.cwd || prev?.cwd || '',
      project: where ? where.project : null,
      key: where ? where.key : null,
      status: next.status,
      detail: next.detail,
      event: ev.event,
      since: same ? prev.since : ev.t,
      at: ev.t,
    };
    sessions.set(ev.sessionId, record);
    prune();
    const changed = !same || prev.detail !== record.detail || prev.key !== record.key;
    return { status: 200, record, changed };
  }

  // The latest live status per session key for one project, plus sessions in
  // unknown folders (shown as "other"). Ended sessions are left out.
  function forProject(index) {
    prune();
    const byKey = {};
    const other = [];
    for (const r of sessions.values()) {
      if (r.status === 'ended') continue;
      const view = { status: r.status, detail: r.detail, since: r.since, at: r.at, sessionId: r.sessionId, cwd: r.cwd };
      if (r.project == null) { other.push({ ...view, folder: path.basename(r.cwd || '') || 'unknown folder' }); continue; }
      if (r.project !== index) continue;
      if (!byKey[r.key] || byKey[r.key].at < r.at) byKey[r.key] = view;
    }
    other.sort((a, b) => b.at - a.at);
    return { byKey, other };
  }

  return { handle, forProject, sessions };
}
