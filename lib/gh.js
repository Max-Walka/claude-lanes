// PR state from the gh CLI. Read-only: GraphQL queries and `gh pr list`, run
// with cwd = the project's repo folder (gh finds owner/repo from its remote).
//
// API budget: GitHub allows 5,000 GraphQL points an hour per account, shared
// with everything else signed in as that account (the lanes push as it too).
// So all PRs go in one batched query per refresh, and a merged or closed PR is
// never asked about again. When a lookup fails, the last good answer is kept.
import { execFile } from 'node:child_process';
import { ciSummary, greptileScore } from './parse.js';

const TIMEOUT_MS = 30_000;
const BATCH = 25;

function gh(args, cwd) {
  return new Promise((resolve) => {
    execFile('gh', args, { cwd, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function parseJson(s) { try { return JSON.parse(s); } catch { return undefined; } }

// GraphQL check states to the buckets `gh pr checks` uses (pass, fail, pending, skipping, cancel).
export function checkBucket(c) {
  if (c.__typename === 'StatusContext') {
    return { SUCCESS: 'pass', PENDING: 'pending', EXPECTED: 'pending', FAILURE: 'fail', ERROR: 'fail' }[c.state] || 'pending';
  }
  if (c.status && c.status !== 'COMPLETED') return 'pending';
  return { SUCCESS: 'pass', NEUTRAL: 'pass', SKIPPED: 'skipping', CANCELLED: 'cancel', STALE: 'skipping' }[c.conclusion] || 'fail';
}

// One pullRequest node from the batched query to the page's PR shape.
export function prFromNode(node) {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const contexts = rollup?.contexts?.nodes || [];
  const checks = contexts.map((c) => ({ name: c.name || c.context || 'check', bucket: checkBucket(c) }));
  return {
    ok: true,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state, // OPEN | MERGED | CLOSED
    draft: !!node.isDraft,
    branch: node.headRefName,
    ci: rollup ? ciSummary(checks) : 'none',
    checks,
    greptile: greptileScore(node.body),
    threads: Array.isArray(node.reviewThreads?.nodes) ? node.reviewThreads.nodes.filter((t) => !t.isResolved).length : null,
  };
}

const FIELDS = `number title state url body isDraft headRefName
  reviewThreads(first: 50) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 40) { nodes {
    __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }`;

// Returns { prs: {number: pr}, error } for one batch. A number that is not a
// PR comes back as null for its alias, and is simply left out.
async function fetchBatch(numbers, cwd) {
  const parts = numbers.map((n) => `p${Number(n)}: pullRequest(number: ${Number(n)}) { ${FIELDS} }`);
  const query = `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${parts.join('\n')} } }`;
  const res = await gh(['api', 'graphql', '-f', `query=${query}`, '-F', 'owner={owner}', '-F', 'repo={repo}'], cwd);
  const data = parseJson(res.stdout);
  const repo = data?.data?.repository;
  if (!repo) return { prs: {}, error: describeError(data, res) };
  const prs = {};
  for (const n of numbers) if (repo[`p${n}`]) prs[n] = prFromNode(repo[`p${n}`]);
  return { prs, error: null };
}

function describeError(data, res) {
  const text = [data?.errors?.map((e) => e.message).join('; '), data?.message, res.stderr, res.err?.message].filter(Boolean).join(' ');
  if (/rate limit/i.test(text)) return 'GitHub API rate limit reached';
  if (/auth|login|credential/i.test(text)) return 'gh is not signed in';
  if (/ENOENT/.test(text)) return 'gh is not installed';
  return 'GitHub lookup failed';
}

const caches = new Map(); // repoFolder -> Map(number -> pr)

// Returns { prs: {number: pr}, error }. A PR with no answer yet is { ok:false }.
export async function fetchPrStates(numbers, repoFolder) {
  if (!repoFolder || !numbers.length) return { prs: Object.fromEntries(numbers.map((n) => [n, { ok: false, number: n }])), error: repoFolder ? null : 'No repo folder set' };
  if (!caches.has(repoFolder)) caches.set(repoFolder, new Map());
  const cache = caches.get(repoFolder);
  const final = (p) => p && p.ok && (p.state === 'MERGED' || p.state === 'CLOSED');
  const todo = numbers.filter((n) => !final(cache.get(n)));
  let error = null;
  for (let i = 0; i < todo.length; i += BATCH) {
    const res = await fetchBatch(todo.slice(i, i + BATCH), repoFolder).catch(() => ({ prs: {}, error: 'GitHub lookup failed' }));
    if (res.error) { error = res.error; break; } // a rate limit fails every batch; stop asking
    for (const [n, p] of Object.entries(res.prs)) cache.set(Number(n), p);
  }
  return { prs: Object.fromEntries(numbers.map((n) => [n, cache.get(n) || { ok: false, number: n }])), error };
}
