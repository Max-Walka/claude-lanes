import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaneStatus, parseBoard, boardState, etaMinutes, etaShort, parseStarted, parseDecision, parseDoneToday } from '../lib/parse.js';

const BOARD = `Updated: 2026-11-10 10:05
State: Needs decision
Now: checkout copy fields
Started: 2026-11-10T09:35:00+13:00
ETA: ~40 min
Decision: q-1110-schema, blocked in ~2 h
Branch: feat/checkout-copy
Open PRs: #215 (open)
Blocked on: none
Done today:
  - Payment step | #212 | started 08:10 | finished 09:20 | took 1h 10m
  - Spec notes | none | started 07:30 | finished 08:00 | took 30m
Handoff: half way through the field list.`;

test('board fields parse from a lane file', () => {
  const { fields } = parseLaneStatus(BOARD);
  assert.equal(fields.State, 'Needs decision');
  assert.equal(fields.Now, 'checkout copy fields');
  const b = parseBoard(fields);
  assert.equal(b.state, 'decision');
  assert.equal(b.started, Date.parse('2026-11-10T09:35:00+13:00'));
  assert.equal(b.eta, '~40 min');
  assert.equal(b.etaMinutes, 40);
  assert.deepEqual(b.decision, { id: 'q-1110-schema', blockedIn: '~2 h', text: 'q-1110-schema, blocked in ~2 h' });
  assert.equal(b.doneToday.length, 2);
  assert.deepEqual(b.doneToday[0], { task: 'Payment step', pr: 212, started: '08:10', finished: '09:20', took: '1h 10m' });
  assert.equal(b.doneToday[1].pr, null);
});

test('older boards have no board fields', () => {
  const { fields } = parseLaneStatus('Updated: 10:00\nNow: x\nBlocked on: the API\nHandoff: y');
  const b = parseBoard(fields);
  assert.equal(b.state, null);
  assert.equal(b.started, null);
  assert.equal(b.eta, null);
  assert.equal(b.decision, null);
  assert.deepEqual(b.doneToday, []);
  assert.equal(fields['Blocked on'], 'the API');
});

test('State values', () => {
  assert.equal(boardState('Working'), 'working');
  assert.equal(boardState('needs decision'), 'decision');
  assert.equal(boardState('Blocked (on the API team)'), 'blocked');
  assert.equal(boardState('Stopped (handed off 10:10, needs a restart: /lane b)'), 'stopped');
  assert.equal(boardState('Handing off'), 'handoff');
  assert.equal(boardState('handed off 17:14'), 'handoff');
  assert.equal(boardState('Thinking'), 'other');
  assert.equal(boardState(''), null);
});

test('ETA in minutes', () => {
  assert.equal(etaMinutes('~40 min'), 40);
  assert.equal(etaMinutes('~1 h'), 60);
  assert.equal(etaMinutes('~1h 30m'), 90);
  assert.equal(etaMinutes('1.5 hours'), 90);
  assert.equal(etaMinutes('soon'), null);
});

test('Started times', () => {
  const now = new Date(2026, 10, 10, 11, 0).getTime();
  assert.equal(parseStarted('09:35', now), new Date(2026, 10, 10, 9, 35).getTime());
  assert.equal(parseStarted('23:50', now), new Date(2026, 10, 9, 23, 50).getTime());
  assert.equal(parseStarted('2026-11-10 09:35', now), new Date(2026, 10, 10, 9, 35).getTime());
  assert.equal(parseStarted('2026-11-10T09:35Z (step 2)', now), Date.parse('2026-11-10T09:35Z'));
  assert.equal(parseStarted('none', now), null);
  assert.equal(parseStarted('this morning', now), null);
});

test('Decision and Done today edge cases', () => {
  assert.equal(parseDecision('none'), null);
  assert.deepEqual(parseDecision('waiting on the API team'), { id: null, blockedIn: null, text: 'waiting on the API team' });
  assert.equal(parseDecision('q-1 (blocked in ~ 3 h)').blockedIn, '~3 h');
  assert.deepEqual(parseDoneToday('none'), []);
  assert.deepEqual(parseDoneToday('Quick fix | #12 | 09:00 | 09:20 | 20m'), [{ task: 'Quick fix', pr: 12, started: '09:00', finished: '09:20', took: '20m' }]);
});

test('short ETA for the card', () => {
  assert.equal(etaShort('~3 h, rough (similar steps ran ~3 to 4 h each)'), '~3 h');
  assert.equal(etaShort('#215 ~15 min (CI rerun ~10 min). Next after that: ~2.5 h'), '~15 min');
  assert.equal(etaShort('~1h 30m'), '~1h 30m');
  assert.equal(etaShort('~ 40 min'), '~40 min');
  assert.equal(etaShort('~3 to 4 h'), '~3 to 4 h');
  assert.equal(etaShort('unknown'), null);
});
