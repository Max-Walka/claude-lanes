import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLaneStatus, parseJsonl, normaliseUpdate, normaliseAnswer, needsYou, ciSummary,
  greptileScore, sessionKey, trackedPrs, localIso, isNone, sessionsFromFiles,
} from '../lib/parse.js';

test('lane status: keys, multi-line Handoff', () => {
  const s = parseLaneStatus('Updated: today\nNow: B4b part 3\nOpen PRs: #1937 (ready)\nBlocked on: none\nHandoff: first\n  second\n  third\n');
  assert.equal(s.fields.Now, 'B4b part 3');
  assert.equal(s.fields['Open PRs'], '#1937 (ready)');
  assert.equal(s.fields.Handoff, 'first\nsecond\nthird');
  assert.ok(isNone(s.fields['Blocked on']));
  assert.ok(!isNone('Lane B, the e2e fix'));
});

test('jsonl: bad lines and non-objects skipped', () => {
  const items = parseJsonl('{"a":1}\nnot json\n[1]\n\n"str"\n{"b":2}\r\n');
  assert.deepEqual(items.map((i) => Object.keys(i)[0]), ['a', 'b']);
});

test('session names', () => {
  assert.equal(sessionKey('Lane A'), 'lane-a');
  assert.equal(sessionKey('lane-b'), 'lane-b');
  assert.equal(sessionKey('Coordinator'), 'coordinator');
  assert.equal(sessionKey('User'), null);
  assert.equal(sessionKey('Lane D'), 'lane-d');
  assert.equal(sessionKey('lane e'), 'lane-e');
  assert.equal(sessionKey('Lane Infra'), 'lane-infra');});

test('sessions come from the lane-*.md files, in order', () => {
  const got = sessionsFromFiles(['plan.md', 'lane-b.md', 'lane-d.md', 'Lane-A.md', 'lane-c.md', 'lane-10.md', 'lane-2.md', 'lanes.md', 'lane-.md', 'lane-a-b55-notes.md', 'lane-c-m2b-plan.md', 'lane-b-inventory.txt', 'updates.jsonl', 'lane-d.md']);
  assert.deepEqual(got.map((s) => s.name), ['Coordinator', 'Lane 2', 'Lane A', 'Lane B', 'Lane C', 'Lane D', 'Lane 10']);
  assert.deepEqual(got[5], { key: 'lane-d', name: 'Lane D', file: 'lane-d.md' });
  assert.deepEqual(sessionsFromFiles([]).map((s) => s.key), ['coordinator']);
});

const U = (o) => normaliseUpdate({ _line: 0, ...o });
const A = (o) => normaliseAnswer({ _line: 0, ...o });

test('needs you: open, sent, settled questions; ready PRs hide when merged', () => {
  const updates = [
    U({ ts: '2026-11-09T10:00:00+13:00', id: 'q1', from: 'Coordinator', kind: 'question', text: 'one', options: ['a', 'b'] }),
    U({ ts: '2026-11-09T10:01:00+13:00', id: 'q2', from: 'Coordinator', kind: 'question', text: 'two' }),
    U({ ts: '2026-11-09T10:02:00+13:00', id: 'q3', from: 'Coordinator', kind: 'question', text: 'three' }),
    U({ ts: '2026-11-09T10:03:00+13:00', from: 'Coordinator', kind: 'done', replyTo: 'q3' }),
    U({ ts: '2026-11-09T10:04:00+13:00', from: 'Lane A', kind: 'ready', pr: 1937, text: 'r' }),
    U({ ts: '2026-11-09T10:05:00+13:00', from: 'Lane B', kind: 'ready', pr: 1939, text: 'r' }),
  ];
  const answers = [A({ id: 'a-1', to: 'Coordinator', replyTo: 'q2', text: 'ok' }), A({ id: 'a-2', to: 'Coordinator', replyTo: 'pr-1937', pr: 1937, text: 'x' })];
  const n = needsYou(updates, answers, { 1939: { ok: true, state: 'MERGED' } });
  const st = Object.fromEntries(n.questions.map((q) => [q.id, q.status]));
  assert.deepEqual(st, { q1: 'open', q2: 'sent', q3: 'settled' });
  assert.deepEqual(n.ready.map((r) => r.pr), [1937]);
  assert.equal(n.ready[0].replies.length, 1);
});

test('unknown kinds and fields are tolerated', () => {
  const u = U({ kind: 'weird', from: 'Lane C', pr: '#12', extra: 1 });
  assert.equal(u.kind, 'weird');
  assert.equal(u.pr, 12);
});

test('tracked PRs from updates and Open PRs lines', () => {
  const prs = trackedPrs([U({ pr: 5 })], { 'lane-a': { key: 'lane-a', exists: true, fields: { 'Open PRs': '#7 (open), #8' } } });
  assert.deepEqual(prs, [8, 7, 5]);
});

test('CI and Greptile', () => {
  assert.equal(ciSummary([{ bucket: 'pass' }, { bucket: 'skipping' }]), 'pass');
  assert.equal(ciSummary([{ bucket: 'pass' }, { bucket: 'pending' }]), 'pending');
  assert.equal(ciSummary([{ bucket: 'pending' }, { bucket: 'fail' }]), 'fail');
  assert.equal(ciSummary([]), 'none');
  assert.equal(greptileScore('<h3>Confidence Score: 4/5</h3>'), 4);
  assert.equal(greptileScore('**Confidence Score: 5/5**'), 5);
  assert.equal(greptileScore('nothing'), null);
});

test('local ISO timestamp has an offset', () => {
  assert.match(localIso(new Date()), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
});

test('merge-order labels', async () => {
  const { normaliseUpdate } = await import('../lib/parse.js');
  const u = normaliseUpdate({ kind: 'merge-order', from: 'Coordinator', prs: [5, 7], labels: { 5: ' Pay by card ', '#7': 'Search', x: 'bad', 9: 3 } });
  assert.deepEqual(u.labels, { 5: 'Pay by card', 7: 'Search' });
  assert.deepEqual(normaliseUpdate({ kind: 'merge-order', labels: ['no'] }).labels, {});
});

test('update tags: trimmed, lower case, unique', () => {
  const u = normaliseUpdate({ ts: '2026-01-01T00:00:00Z', from: 'Coordinator', kind: 'todo', text: 'x', tags: ['Urgent', ' blocking ', 'urgent', ''] }, 0);
  assert.deepEqual(u.tags, ['urgent', 'blocking']);
  assert.deepEqual(normaliseUpdate({ ts: '2026-01-01T00:00:00Z', from: 'Coordinator', kind: 'info', text: 'x' }, 0).tags, []);
});

test('normaliseUpdate keeps sql queries exactly and drops empty ones', () => {
  const q = 'SELECT 1;\n\n  -- two spaces kept\n';
  const u = U({ kind: 'todo', id: 't1', sql: [{ title: ' 1 of 2: first ', query: q, expect: 'One row.' }, { title: 'empty', query: '  ' }, 'junk'] });
  assert.deepEqual(u.sql, [{ title: '1 of 2: first', query: q, expect: 'One row.' }]);
  assert.deepEqual(U({ kind: 'todo', id: 't2' }).sql, []);
});

test('waitsFor, check and staging releases', async () => {
  const { releaseMatches, waitingReleases } = await import('../lib/parse.js');
  const t = U({ kind: 'todo', id: 'w1', check: 'Staging', waitsFor: { pr: '#12', stagingRelease: 'A50FE0B' } });
  assert.equal(t.check, 'staging');
  assert.deepEqual(t.waitsFor, { pr: 12, stagingRelease: 'a50fe0b' });
  assert.equal(U({ kind: 'todo', id: 'w2', waitsFor: { stagingRelease: 'nope' } }).waitsFor, null);
  assert.equal(U({ kind: 'todo', id: 'w3' }).waitsFor, null);
  assert.ok(releaseMatches('a50fe0b', 'a50fe0b1234'));
  assert.ok(releaseMatches('A50FE0B9', 'a50fe0b'));
  assert.ok(!releaseMatches('a50fe0b', 'b50fe0b'));
  assert.ok(!releaseMatches('', 'a50fe0b'));
  assert.ok(!releaseMatches('a50f', 'a50f'));
  const ups = [t, U({ kind: 'todo', id: 'w4', waitsFor: { stagingRelease: 'bbbbbbb' } }), U({ kind: 'done', replyTo: 'w4' })];
  assert.deepEqual(waitingReleases(ups, []), ['a50fe0b']);
  assert.deepEqual(waitingReleases(ups, [{ replyTo: 'w1', done: true }]), []);
  assert.ok(trackedPrs([t], {}).includes(12));
});
