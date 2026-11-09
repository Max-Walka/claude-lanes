// PR state from the gh CLI. Read-only: only `gh pr view`, `gh pr checks` and
// a GraphQL query for review threads, run with cwd = the project's repo folder.
import { execFile } from 'node:child_process';
import { ciSummary, greptileScore } from './parse.js';

const TIMEOUT_MS = 30_000;

function gh(args, cwd) {
  return new Promise((resolve) => {
    execFile('gh', args, { cwd, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function parseJson(s) { try { return JSON.parse(s); } catch { return undefined; } }

async function fetchOne(n, cwd) {
  const view = await gh(['pr', 'view', String(n), '--json', 'number,title,state,url,body,isDraft,mergedAt,headRefName'], cwd);
  const pr = parseJson(view.stdout);
  if (!pr || typeof pr !== 'object') return { ok: false, number: n };

  // `gh pr checks` exits non-zero while checks are pending or failing, but
  // still prints JSON, so read stdout whatever the exit code.
  const checksRes = await gh(['pr', 'checks', String(n), '--json', 'name,state,bucket'], cwd);
  let checks = parseJson(checksRes.stdout);
  if (!Array.isArray(checks)) {
    // "no checks reported" is a real answer, anything else means unknown.
    checks = /no checks/i.test(checksRes.stderr) ? [] : null;
  }

  return {
    ok: true,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state, // OPEN | MERGED | CLOSED
    draft: !!pr.isDraft,
    branch: pr.headRefName,
    ci: checks == null ? 'unknown' : ciSummary(checks),
    checks: (checks || []).map((c) => ({ name: c.name, bucket: c.bucket })),
    greptile: greptileScore(pr.body),
    threads: null,
  };
}

async function fetchThreads(numbers, cwd) {
  if (!numbers.length) return {};
  const parts = numbers.map((n) => `p${n}: pullRequest(number: ${Number(n)}) { reviewThreads(first: 100) { nodes { isResolved isOutdated } } }`);
  const query = `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${parts.join(' ')} } }`;
  const res = await gh(['api', 'graphql', '-f', `query=${query}`, '-F', 'owner={owner}', '-F', 'repo={repo}'], cwd);
  const data = parseJson(res.stdout);
  const repo = data && data.data && data.data.repository;
  const out = {};
  if (!repo) return out;
  for (const n of numbers) {
    const nodes = repo[`p${n}`] && repo[`p${n}`].reviewThreads && repo[`p${n}`].reviewThreads.nodes;
    if (Array.isArray(nodes)) out[n] = nodes.filter((t) => !t.isResolved).length;
  }
  return out;
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k]); }
  });
  await Promise.all(workers);
  return results;
}

// Returns { [number]: state } where state.ok === false means "PR state unavailable".
export async function fetchPrStates(numbers, repoFolder) {
  if (!repoFolder || !numbers.length) return Object.fromEntries(numbers.map((n) => [n, { ok: false, number: n }]));
  const list = await pool(numbers, 3, (n) => fetchOne(n, repoFolder).catch(() => ({ ok: false, number: n })));
  const okNums = list.filter((p) => p.ok).map((p) => p.number);
  const threads = await fetchThreads(okNums, repoFolder).catch(() => ({}));
  const out = {};
  numbers.forEach((n, idx) => {
    const p = list[idx];
    if (p.ok) p.threads = threads[p.number] ?? null;
    out[n] = p;
  });
  return out;
}

// Open PRs by the account gh is signed in as (the one the lanes push as).
// Returns { count, numbers } or null when gh fails.
export async function fetchOpenMine(repoFolder) {
  if (!repoFolder) return null;
  const res = await gh(['pr', 'list', '--author', '@me', '--state', 'open', '--json', 'number', '--limit', '500'], repoFolder);
  const list = parseJson(res.stdout);
  if (!Array.isArray(list)) return null;
  const numbers = list.map((p) => p.number).filter(Number.isInteger).sort((a, b) => a - b);
  return { count: numbers.length, numbers };
}
