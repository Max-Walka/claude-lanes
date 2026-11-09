// Pure parsing helpers. No file system access here, so they are easy to test.

export const SESSIONS = [
  { key: 'coordinator', name: 'Coordinator', file: 'coordinator.md' },
  { key: 'lane-a', name: 'Lane A', file: 'lane-a.md' },
  { key: 'lane-b', name: 'Lane B', file: 'lane-b.md' },
  { key: 'lane-c', name: 'Lane C', file: 'lane-c.md' },
];

export const LANE_KEYS = [
  'Updated', 'Now', 'Branch', 'Open PRs', 'Files claimed',
  'Blocked on', 'Needs from other lanes', 'Handoff',
];

export const KINDS = ['ready', 'question', 'blocked', 'info', 'done'];

// Map "Lane A", "lane-a", "lane a", "coordinator" to a session key, or null.
export function sessionKey(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (n === 'coordinator') return 'coordinator';
  const m = n.match(/^lane-?([abc])$/);
  return m ? `lane-${m[1]}` : null;
}

// Parse a lane status file of `Key: value` lines. Lines that do not start a
// known key are continuations of the previous key (Handoff runs long).
export function parseLaneStatus(text) {
  const fields = {};
  const order = [];
  const extra = [];
  let current = null;
  const keyRe = new RegExp(`^\\s*(${LANE_KEYS.map(escapeRe).join('|')})\\s*:\\s?(.*)$`, 'i');
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const m = raw.match(keyRe);
    if (m) {
      const key = LANE_KEYS.find((k) => k.toLowerCase() === m[1].toLowerCase());
      current = key;
      if (!(key in fields)) order.push(key);
      fields[key] = fields[key] ? `${fields[key]}\n${m[2]}` : m[2];
    } else if (current) {
      fields[current] += `\n${raw.replace(/^\s{0,2}/, '')}`;
    } else if (raw.trim()) {
      extra.push(raw);
    }
  }
  for (const k of order) fields[k] = fields[k].replace(/\s+$/, '');
  return { fields, order, extra };
}

// The first "Key: value" line in any status file, for the coordinator too.
export function readField(text, key) {
  const m = String(text).match(new RegExp(`^\\s*${escapeRe(key)}\\s*:\\s*(.*)$`, 'im'));
  return m ? m[1].trim() : null;
}

export function prNumbers(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/#(\d{1,7})\b/g)) out.add(Number(m[1]));
  return [...out];
}

export function isNone(value) {
  if (value == null) return true;
  const v = String(value).trim().toLowerCase().replace(/[.\s]+$/, '');
  return v === '' || v === 'none' || v === 'nothing' || v === 'n/a' || v === '-' || v.startsWith('none ') || v.startsWith('none,') || v.startsWith('none;');
}

// Parse JSON lines. Bad lines and non-objects are skipped, never thrown.
export function parseJsonl(text) {
  const items = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    let obj;
    try { obj = JSON.parse(s); } catch { return; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    items.push({ ...obj, _line: i });
  });
  return items;
}

function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
function prNum(v) {
  const n = typeof v === 'string' ? Number(v.replace(/^#/, '')) : v;
  return Number.isInteger(n) && n > 0 ? n : null;
}
function tsMs(v) {
  const t = Date.parse(str(v));
  return Number.isNaN(t) ? null : t;
}

// Keep only the fields the page uses, with safe types.
export function normaliseUpdate(u) {
  const kind = str(u.kind).toLowerCase();
  return {
    line: u._line,
    ts: str(u.ts),
    t: tsMs(u.ts),
    id: u.id == null ? null : str(u.id),
    from: str(u.from) || 'Unknown',
    to: str(u.to),
    fromKey: sessionKey(u.from),
    toKey: sessionKey(u.to),
    kind: KINDS.includes(kind) ? kind : (kind || 'info'),
    pr: prNum(u.pr),
    text: str(u.text),
    options: Array.isArray(u.options) ? u.options.map(str).filter(Boolean) : [],
    replyTo: u.replyTo == null ? null : str(u.replyTo),
    about: u.about == null ? null : str(u.about),
    aboutKey: sessionKey(u.about),
    prs: Array.isArray(u.prs) ? u.prs.map(prNum).filter(Boolean) : [],
    note: u.note == null ? '' : str(u.note),
    source: u.source == null ? null : str(u.source),
    after: u.after == null ? null : str(u.after),
    title: u.title == null ? '' : str(u.title),
    steps: Array.isArray(u.steps) ? u.steps.map(str).filter(Boolean) : [],
  };
}

export function normaliseAnswer(a) {
  return {
    line: a._line,
    ts: str(a.ts),
    t: tsMs(a.ts),
    id: str(a.id),
    to: str(a.to),
    replyTo: a.replyTo == null ? null : str(a.replyTo),
    pr: prNum(a.pr),
    choice: Number.isInteger(a.choice) ? a.choice : null,
    text: str(a.text),
    attachments: Array.isArray(a.attachments) ? a.attachments.map(str) : [],
    done: a.done === true,
  };
}

// Newest first. Lines without a valid ts sort by file position.
export function sortNewestFirst(list) {
  return [...list].sort((a, b) => {
    if (a.t != null && b.t != null && a.t !== b.t) return b.t - a.t;
    if (a.t == null && b.t != null) return 1;
    if (b.t == null && a.t != null) return -1;
    return b.line - a.line;
  });
}

// Build the "Needs you" model. prState maps PR number to cached state, if known.
export function needsYou(updates, answers, prState = {}) {
  const doneIds = new Map();
  for (const u of updates) if (u.kind === 'done' && u.replyTo) doneIds.set(u.replyTo, u);
  const answersFor = (id) => sortNewestFirst(answers.filter((a) => a.replyTo === id)).reverse();

  const questions = [];
  const seenQ = new Set();
  for (const u of sortNewestFirst(updates)) {
    if (u.kind !== 'question' || !u.id || seenQ.has(u.id)) continue;
    seenQ.add(u.id);
    const replies = answersFor(u.id);
    const done = doneIds.get(u.id) || null;
    const status = done ? 'settled' : replies.length ? 'sent' : 'open';
    questions.push({ ...u, replies, done, status });
  }

  const ready = [];
  const seenPr = new Set();
  for (const u of sortNewestFirst(updates)) {
    if (u.kind !== 'ready' || !u.pr || seenPr.has(u.pr)) continue;
    seenPr.add(u.pr);
    const st = prState[u.pr];
    if (st && st.ok && (st.state === 'MERGED' || st.state === 'CLOSED')) continue;
    const reporters = updates.filter((x) => x.kind === 'ready' && x.pr === u.pr);
    ready.push({ ...u, reporters: [...new Set(reporters.map((r) => r.from))], replies: answersFor(`pr-${u.pr}`) });
  }
  return { questions, ready };
}

// Every PR the page should track: from updates and from Open PRs lines.
export function trackedPrs(updates, statuses) {
  const set = new Set();
  for (const u of updates) {
    if (u.pr) set.add(u.pr);
    for (const n of u.prs || []) set.add(n);
  }
  for (const s of Object.values(statuses)) {
    if (!s || !s.exists) continue;
    const open = s.key === 'coordinator' ? s.raw : (s.fields && s.fields['Open PRs']) || '';
    for (const n of prNumbers(open)) set.add(n);
  }
  return [...set].sort((a, b) => b - a);
}

// Summarise `gh pr checks --json name,state,bucket` output.
export function ciSummary(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'none';
  const buckets = checks.map((c) => String(c.bucket || '').toLowerCase());
  if (buckets.some((b) => b === 'fail' || b === 'cancel')) return 'fail';
  if (buckets.some((b) => b === 'pending')) return 'pending';
  if (buckets.some((b) => b === 'pass')) return 'pass';
  return 'none';
}

export function greptileScore(body) {
  const m = String(body || '').match(/Confidence\s+Score\s*:?\s*\**\s*(\d)\s*\/\s*5/i);
  return m ? Number(m[1]) : null;
}

// ISO timestamp with the machine's local offset, like 2026-11-09T17:06:22+13:00.
export function localIso(d = new Date()) {
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
