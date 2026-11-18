import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBucket, prFromNode, latestRuns } from '../lib/gh.js';

test('check states map to gh pr checks buckets', () => {
  assert.equal(checkBucket({ __typename: 'CheckRun', status: 'IN_PROGRESS' }), 'pending');
  assert.equal(checkBucket({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }), 'pass');
  assert.equal(checkBucket({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }), 'skipping');
  assert.equal(checkBucket({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }), 'fail');
  assert.equal(checkBucket({ __typename: 'StatusContext', state: 'PENDING' }), 'pending');
  assert.equal(checkBucket({ __typename: 'StatusContext', state: 'SUCCESS' }), 'pass');
});

test('a batched pullRequest node becomes the page PR shape', () => {
  const node = {
    number: 7, title: 'feat: x', state: 'OPEN', url: 'https://example.test/pr/7', isDraft: false, headRefName: 'b',
    body: 'Confidence Score: 4/5',
    reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'e2e', status: 'QUEUED', conclusion: null },
    ] } } } }] },
  };
  const p = prFromNode(node);
  assert.equal(p.ok, true);
  assert.equal(p.ci, 'pending');
  assert.equal(p.greptile, 4);
  assert.equal(p.threads, 1);
  assert.deepEqual(p.checks.map((c) => c.bucket), ['pass', 'pending']);
  assert.equal(prFromNode({ ...node, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }).ci, 'none');
});

test('a check run twice counts by its latest run; cancelled alone is neutral', () => {
  const run = (name, conclusion, startedAt, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt });
  const node = (runs) => ({ number: 1, title: 't', url: 'u', state: 'OPEN', headRefName: 'b', commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: runs } } } }] } });
  // Cancelled first, success later (either order in the list): pass.
  const later = [run('Build', 'CANCELLED', '2026-11-11T08:00:00Z'), run('Build', 'SUCCESS', '2026-11-11T08:05:00Z'), run('Lint', 'SUCCESS', '2026-11-11T08:00:00Z')];
  assert.equal(prFromNode(node(later)).ci, 'pass');
  assert.equal(prFromNode(node([...later].reverse())).ci, 'pass');
  assert.deepEqual(prFromNode(node(later)).checks.map((c) => c.name), ['Build', 'Lint']);
  // Success first, a newer failure: fail.
  assert.equal(prFromNode(node([run('Tests', 'SUCCESS', '2026-11-11T08:00:00Z'), run('Tests', 'FAILURE', '2026-11-11T09:00:00Z')])).ci, 'fail');
  // A re-run still queued (no start time) is the newest: pending.
  assert.equal(prFromNode(node([run('Tests', 'FAILURE', '2026-11-11T08:00:00Z'), run('Tests', null, null, 'QUEUED')])).ci, 'pending');
  // Cancelled on its own is not a failure.
  assert.equal(prFromNode(node([run('Tests', 'CANCELLED', '2026-11-11T08:00:00Z'), run('Lint', 'SUCCESS', '2026-11-11T08:00:00Z')])).ci, 'pass');
  assert.equal(latestRuns([]).length, 0);
});
