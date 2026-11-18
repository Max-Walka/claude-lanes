import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBucket, prFromNode } from '../lib/gh.js';

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
