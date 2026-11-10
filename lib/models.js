// Which model each session runs, read (never written) from Claude Code's own transcripts.
// A transcript is ~/.claude/projects/<folder>/<session id>.jsonl. Sessions started with
// `claude -n "<name>"` carry {"type":"agent-name","agentName":"<name>"} lines, and every
// reply carries "model":"claude-...". Only the start and end of each file are read.
import fs from 'node:fs/promises';
import path from 'node:path';

const HEAD_BYTES = 16 * 1024;
const TAIL_BYTES = 256 * 1024;
const RECENT_MS = 48 * 3600 * 1000;

// From a transcript's text: the session name and the model of its latest reply, or nulls.
// Only whole lines are trusted: the model of an assistant reply, the name of an agent-name line
// (a "model" quoted inside tool output is ignored).
export function readTranscript(text) {
  let name = null;
  let model = null;
  for (const line of String(text).split('\n')) {
    const isName = line.includes('"agent-name"');
    const isReply = line.includes('"assistant"') && line.includes('"model"');
    if (!isName && !isReply) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; } // a cut line at the edge of a read
    if (o?.type === 'agent-name' && typeof o.agentName === 'string' && o.agentName.trim()) name = o.agentName.trim();
    else if (o?.type === 'assistant' && /^claude-/i.test(o.message?.model || '')) model = o.message.model;
  }
  return { name, model };
}

// "claude-opus-5-5" -> "Opus 5.5", "claude-sonnet-4-5-20250929" -> "Sonnet 4.5",
// "claude-3-5-haiku-20241022" -> "Haiku 3.5". Anything else is returned as it is.
export function modelLabel(id) {
  const s = String(id || '');
  let m = s.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  m = s.match(/^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/i);
  if (m) return `${m[3][0].toUpperCase()}${m[3].slice(1)} ${m[1]}${m[2] ? `.${m[2]}` : ''}`;
  return s;
}

async function readEnds(file, size) {
  const fh = await fs.open(file, 'r');
  try {
    if (size <= HEAD_BYTES + TAIL_BYTES) return (await fh.readFile('utf8'));
    const head = Buffer.alloc(HEAD_BYTES);
    const tail = Buffer.alloc(TAIL_BYTES);
    await fh.read(head, 0, HEAD_BYTES, 0);
    await fh.read(tail, 0, TAIL_BYTES, size - TAIL_BYTES);
    return `${head.toString('utf8')}\n${tail.toString('utf8')}`;
  } finally { await fh.close(); }
}

// { "<session name>": { model, label, at } } for the given names, newest transcript wins.
export async function findModels(folder, names, now = Date.now()) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const out = {};
  let dirs = [];
  try { dirs = await fs.readdir(folder, { withFileTypes: true }); } catch { return out; }
  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let entries = [];
    try { entries = await fs.readdir(path.join(folder, d.name)); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(folder, d.name, f);
      try {
        const st = await fs.stat(full);
        if (now - st.mtimeMs < RECENT_MS) files.push({ full, at: st.mtimeMs, size: st.size });
      } catch { /* gone */ }
    }
  }
  files.sort((a, b) => b.at - a.at);
  for (const f of files) {
    if (Object.keys(out).length === wanted.size) break;
    let info;
    try { info = readTranscript(await readEnds(f.full, f.size)); } catch { continue; }
    if (!info.name || !info.model) continue;
    const key = names.find((n) => n.toLowerCase() === info.name.toLowerCase());
    if (!key || out[key]) continue;
    out[key] = { model: info.model, label: modelLabel(info.model), at: f.at };
  }
  return out;
}
