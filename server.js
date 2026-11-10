// Lanes dashboard server. Listens on 127.0.0.1 only.
// Reads the lanes folder; writes only answers.jsonl and new files in attachments/.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import {
  SESSIONS, parseLaneStatus, parseBoard, readField, parseJsonl, normaliseUpdate, normaliseAnswer,
  sortNewestFirst, needsYou, trackedPrs, localIso, sessionKey,
} from './lib/parse.js';
import { fetchPrStates } from './lib/gh.js';
import { findModels } from './lib/models.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PR_REFRESH_MS = 60_000;
const POLL_MS = 2_000;
const MAX_BODY = 120 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOCS = { plan: 'plan.md', rules: 'rules.md', 'coordinator-rules': 'coordinator-rules.md' };

// ---------- config ----------
const configPath = path.resolve(process.env.LANES_CONFIG || path.join(ROOT, 'config.json'));
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT' && !process.env.LANES_CONFIG) {
    console.error('No config.json yet. Copy config.example.json to config.json and add your project.');
    console.error('Or try it with demo data first: npm run demo');
  } else console.error(`Could not read ${configPath}: ${e.message}`);
  process.exit(1);
}
const configDir = path.dirname(configPath);
// The name sessions use for the person they work for, in "to" and "from" (default "User").
const PERSON = String(config.person || 'User').trim() || 'User';
const projects = (Array.isArray(config.projects) ? config.projects : [])
  .filter((p) => p && typeof p.lanesFolder === 'string' && p.lanesFolder.trim())
  .map((p, index) => ({
    index,
    name: String(p.name || path.basename(p.lanesFolder)),
    lanesFolder: path.resolve(configDir, expandHome(p.lanesFolder)),
    repoFolder: p.repoFolder ? path.resolve(configDir, expandHome(p.repoFolder)) : null,
    // For demos and tests: PR states from a JSON file instead of gh.
    prStateFile: p.prStateFile ? path.resolve(configDir, expandHome(p.prStateFile)) : null,
  }));
if (!projects.length) {
  console.error(`No projects in ${configPath}. Add { "name", "lanesFolder", "repoFolder" } entries under "projects".`);
  process.exit(1);
}
const PORT = Number(process.env.PORT || config.port || 4317);
// Each session's model, read from Claude Code's transcripts. "showModels": false turns it off;
// "transcriptsFolder" points elsewhere than ~/.claude/projects.
const SHOW_MODELS = config.showModels !== false;
const TRANSCRIPTS = path.resolve(configDir, expandHome(String(config.transcriptsFolder || '~/.claude/projects')));

function expandHome(p) {
  return p.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '~');
}

// ---------- markdown ----------
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeRenderer = {
  renderer: {
    html(token) { return escapeHtml(token.text ?? token.raw ?? ''); },
    link(token) {
      const href = String(token.href || '');
      const text = this.parser.parseInline(token.tokens);
      if (!/^https?:\/\//i.test(href)) return text;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
    },
    image(token) { return escapeHtml(token.text || ''); },
  },
};
const md = new Marked({ gfm: true, breaks: false }).use(safeRenderer);
const mdBreaks = new Marked({ gfm: true, breaks: true }).use(safeRenderer);

// The page shows no em dashes, so swap them in anything read from files.
const EM_DASH = new RegExp(`\\s*${String.fromCharCode(8212)}\\s*`, 'g');
export const noEmDash = (s) => String(s).replace(EM_DASH, ', ');
const renderMd = (text, breaks = false) => (breaks ? mdBreaks : md).parse(noEmDash(text));

// ---------- per-project state ----------
const projectState = projects.map(() => ({
  signature: '',
  payload: null,
  prs: {},
  prsFetchedAt: null,
  prsFetching: null,
  prsError: null,
  clients: new Set(),
  watcher: null,
  lastPrSet: '',
}));

async function readText(file) {
  try {
    const [text, st] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
    return { text, mtime: st.mtimeMs, exists: true };
  } catch {
    return { text: '', mtime: null, exists: false };
  }
}

async function folderSignature(p) {
  const names = [...SESSIONS.map((s) => s.file), ...Object.values(DOCS), 'updates.jsonl', 'answers.jsonl'];
  const parts = await Promise.all(names.map(async (n) => {
    try { const st = await fsp.stat(path.join(p.lanesFolder, n)); return `${n}:${st.mtimeMs}:${st.size}`; } catch { return `${n}:-`; }
  }));
  return parts.join('|');
}

async function buildState(i) {
  const p = projects[i];
  const s = projectState[i];
  let folderOk = true;
  try { folderOk = (await fsp.stat(p.lanesFolder)).isDirectory(); } catch { folderOk = false; }

  const sessions = {};
  for (const sess of SESSIONS) {
    const f = await readText(path.join(p.lanesFolder, sess.file));
    const entry = { key: sess.key, name: sess.name, file: sess.file, exists: f.exists, mtime: f.mtime, raw: noEmDash(f.text) };
    entry.updatedLine = f.exists ? readField(f.text, 'Updated') : null;
    if (sess.key === 'coordinator') {
      entry.html = f.exists ? renderMd(f.text.replace(/^\s*Updated\s*:.*$/im, '').trim(), true) : '';
    } else {
      const parsed = parseLaneStatus(noEmDash(f.text));
      entry.fields = parsed.fields;
      entry.order = parsed.order;
      entry.extra = parsed.extra;
      entry.board = parseBoard(parsed.fields);
    }
    sessions[sess.key] = entry;
  }

  const updatesFile = await readText(path.join(p.lanesFolder, 'updates.jsonl'));
  const answersFile = await readText(path.join(p.lanesFolder, 'answers.jsonl'));
  const updates = sortNewestFirst(parseJsonl(updatesFile.text).map(normaliseUpdate))
    .map((u) => ({ ...u, text: noEmDash(u.text), note: noEmDash(u.note), about: u.about && noEmDash(u.about), options: u.options.map(noEmDash), steps: u.steps.map(noEmDash), title: noEmDash(u.title) }));
  const answers = sortNewestFirst(parseJsonl(answersFile.text).map(normaliseAnswer).filter((a) => a.id && a.to))
    .map((a) => ({ ...a, attachments: a.attachments.map((full) => path.basename(full)) }));

  const plan = await readText(path.join(p.lanesFolder, DOCS.plan));
  const docs = {};
  for (const [k, file] of Object.entries(DOCS)) docs[k] = fs.existsSync(path.join(p.lanesFolder, file));

  const prList = trackedPrs(updates, sessions);
  return {
    project: { index: i, name: p.name, lanesFolder: p.lanesFolder, repoFolder: p.repoFolder },
    projects: projects.map((x) => ({ index: x.index, name: x.name })),
    person: PERSON,
    folderOk,
    sessions,
    updates,
    answers,
    needs: needsYou(updates, answers, s.prs),
    planHtml: plan.exists ? renderMd(plan.text) : '',
    docs,
    prList,
    prs: s.prs,
    prsFetchedAt: s.prsFetchedAt,
    prsError: s.prsError ?? null,
    models: SHOW_MODELS ? models : {},
    prsFetching: !!s.prsFetching,
    now: Date.now(),
  };
}

async function refreshState(i, { force = false } = {}) {
  const s = projectState[i];
  const sig = await folderSignature(projects[i]);
  if (!force && sig === s.signature && s.payload) return s.payload;
  s.signature = sig;
  s.payload = await buildState(i);
  const prSet = s.payload.prList.join(',');
  if (prSet !== s.lastPrSet) {
    s.lastPrSet = prSet;
    if (s.clients.size) refreshPrs(i); // new PR numbers appeared
  }
  broadcast(i);
  return s.payload;
}

function broadcast(i) {
  const s = projectState[i];
  if (!s.payload) return;
  const data = `event: state\ndata: ${JSON.stringify(s.payload)}\n\n`;
  for (const res of s.clients) res.write(data);
}

async function refreshPrs(i) {
  const s = projectState[i];
  if (s.prsFetching) return s.prsFetching;
  const run = (async () => {
    const list = s.payload ? s.payload.prList : [];
    try {
      if (projects[i].prStateFile) {
        const demo = JSON.parse(await fsp.readFile(projects[i].prStateFile, 'utf8'));
        s.prs = Object.fromEntries(list.map((n) => [n, demo.prs?.[n] ? { ok: true, number: n, ...demo.prs[n] } : { ok: false, number: n }]));
        s.prsError = null;
      } else {
        const res = await fetchPrStates(list, projects[i].repoFolder);
        s.prs = res.prs;
        s.prsError = res.error;
      }
    } catch {
      s.prsError = 'GitHub lookup failed';
    }
    s.prsFetchedAt = Date.now();
  })();
  s.prsFetching = run;
  if (s.payload) { s.payload.prsFetching = true; broadcast(i); }
  try { await run; } finally { s.prsFetching = null; }
  await refreshState(i, { force: true });
}

function startWatching(i) {
  const p = projects[i];
  const s = projectState[i];
  let timer = null;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => refreshState(i).catch(logErr), 120); };
  const attach = () => {
    if (s.watcher) return;
    try {
      s.watcher = fs.watch(p.lanesFolder, { persistent: true }, kick);
      s.watcher.on('error', () => { try { s.watcher.close(); } catch {} s.watcher = null; });
    } catch { s.watcher = null; }
  };
  attach();
  // Polling backs up fs.watch, which can miss events on network drives and editors that swap files.
  setInterval(() => { attach(); refreshState(i).catch(logErr); }, POLL_MS).unref();
  setInterval(() => { if (s.clients.size) refreshPrs(i).catch(logErr); }, PR_REFRESH_MS).unref();
}

let models = {};
async function refreshModels() {
  const next = await findModels(TRANSCRIPTS, SESSIONS.map((x) => x.name));
  const sig = (m) => JSON.stringify(Object.entries(m).map(([k, v]) => [k, v.model]).sort());
  const changed = sig(next) !== sig(models);
  models = next;
  if (changed) for (const p of projects) await refreshState(p.index, { force: true });
}
if (SHOW_MODELS) {
  refreshModels().catch(logErr);
  setInterval(() => refreshModels().catch(logErr), 60_000).unref();
}

function logErr(e) { console.error(e && e.stack ? e.stack : e); }

// ---------- answers ----------
let writeQueue = Promise.resolve();
function queued(fn) {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SESSION_NAMES = SESSIONS.map((s) => s.name);

function validateAnswer(body) {
  if (!body || typeof body !== 'object') return 'Bad request';
  const i = Number(body.project);
  if (!Number.isInteger(i) || !projects[i]) return 'Unknown project';
  const to = SESSIONS.find((s) => s.key === sessionKey(body.to));
  if (!to) return `"to" must be one of ${SESSION_NAMES.join(', ')}`;
  if (typeof body.text !== 'string' || body.text.length > 20000) return 'Text must be a string under 20,000 characters';
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length > MAX_IMAGES) return `At most ${MAX_IMAGES} images per reply`;
  if (!body.text.trim() && !images.length) return 'Nothing to send';
  if (body.replyTo != null && (typeof body.replyTo !== 'string' || !/^[\w.:-]{1,200}$/.test(body.replyTo))) return 'Bad replyTo';
  if (body.pr != null && !(Number.isInteger(body.pr) && body.pr > 0)) return 'Bad pr';
  if (body.choice != null && !(Number.isInteger(body.choice) && body.choice >= 0 && body.choice < 100)) return 'Bad choice';
  if (body.done != null && body.done !== true) return 'Bad done';
  if (body.done && !body.replyTo) return 'done needs replyTo';
  const buffers = [];
  for (const img of images) {
    const m = typeof img === 'string' && img.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return 'Images must be PNG data URLs';
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return 'Each image must be under 10 MB';
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return 'Not a PNG image';
    buffers.push(buf);
  }
  return { project: projects[i], index: i, to: to.name, buffers };
}

async function writeAnswer(body) {
  const v = validateAnswer(body);
  if (typeof v === 'string') return { status: 400, error: v };
  return queued(async () => {
    const { project, to, buffers } = v;
    const st = await fsp.stat(project.lanesFolder).catch(() => null);
    if (!st || !st.isDirectory()) return { status: 409, error: `Lanes folder not found: ${project.lanesFolder}` };

    const id = `a-${crypto.randomBytes(6).toString('hex')}`;
    const attachments = [];
    if (buffers.length) {
      const dir = path.join(project.lanesFolder, 'attachments');
      await fsp.mkdir(dir, { recursive: true });
      for (let n = 0; n < buffers.length; n++) {
        const file = path.join(dir, `${id}-${n + 1}.png`);
        await fsp.writeFile(file, buffers[n], { flag: 'wx' }); // never overwrite
        attachments.push(file);
      }
    }

    const line = { ts: localIso(), id, to };
    if (body.replyTo) line.replyTo = body.replyTo;
    if (body.pr != null) line.pr = body.pr;
    if (body.choice != null) line.choice = body.choice;
    if (body.done === true) line.done = true;
    line.text = body.text.trim();
    if (attachments.length) line.attachments = attachments;

    const file = path.join(project.lanesFolder, 'answers.jsonl');
    let prefix = '';
    try {
      const fh = await fsp.open(file, 'r');
      try {
        const { size } = await fh.stat();
        if (size > 0) {
          const b = Buffer.alloc(1);
          await fh.read(b, 0, 1, size - 1);
          if (b[0] !== 0x0a) prefix = '\n';
        }
      } finally { await fh.close(); }
    } catch { /* file does not exist yet */ }
    await fsp.appendFile(file, `${prefix}${JSON.stringify(line)}\n`, 'utf8');
    refreshState(v.index, { force: true }).catch(logErr);
    return { status: 200, answer: line };
  });
}

// ---------- http ----------
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function projectIndex(url) {
  const i = Number(url.searchParams.get('p') || 0);
  return Number.isInteger(i) && projects[i] ? i : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // Refuse requests addressed to another host name (DNS rebinding).
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, { error: 'Forbidden host' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())) return send(res, 403, { error: 'Forbidden origin' });
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' });
    }

    if (url.pathname === '/events' && req.method === 'GET') {
      const i = projectIndex(url);
      if (i == null) return send(res, 404, { error: 'Unknown project' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      const s = projectState[i];
      s.clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { clearInterval(ping); s.clients.delete(res); });
      await refreshState(i, { force: !s.payload });
      res.write(`event: state\ndata: ${JSON.stringify(s.payload)}\n\n`);
      if (!s.prsFetchedAt || Date.now() - s.prsFetchedAt > PR_REFRESH_MS) refreshPrs(i).catch(logErr);
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const i = projectIndex(url);
      if (i == null) return send(res, 404, { error: 'Unknown project' });
      return send(res, 200, await refreshState(i));
    }

    if (url.pathname === '/api/doc' && req.method === 'GET') {
      const i = projectIndex(url);
      const file = DOCS[url.searchParams.get('name')];
      if (i == null || !file) return send(res, 404, { error: 'Not found' });
      const f = await readText(path.join(projects[i].lanesFolder, file));
      if (!f.exists) return send(res, 404, { error: `${file} not found` });
      return send(res, 200, { name: file, html: renderMd(f.text) });
    }

    if (url.pathname === '/api/attachment' && req.method === 'GET') {
      const i = projectIndex(url);
      const name = url.searchParams.get('name') || '';
      if (i == null || !/^a-[0-9a-f]{6,32}-\d{1,3}\.png$/.test(name)) return send(res, 404, { error: 'Not found' });
      try { return send(res, 200, await fsp.readFile(path.join(projects[i].lanesFolder, 'attachments', name)), 'image/png'); } catch { return send(res, 404, { error: 'Not found' }); }
    }

    if (url.pathname === '/api/prs/refresh' && req.method === 'POST') {
      const i = projectIndex(url);
      if (i == null) return send(res, 404, { error: 'Unknown project' });
      refreshPrs(i).catch(logErr);
      return send(res, 202, { ok: true });
    }

    if (url.pathname === '/api/answer' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.status ? 'Too large' : 'Bad JSON' }); }
      const r = await writeAnswer(body);
      return send(res, r.status, r.error ? { error: r.error } : { ok: true, answer: r.answer });
    }

    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', 'text/plain');
      try {
        const buf = await fsp.readFile(file);
        return send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
      } catch { return send(res, 404, 'Not found', 'text/plain'); }
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    logErr(e);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is in use. Set "port" in config.json or PORT=... to use another.`);
  else logErr(e);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  projects.forEach((_, i) => startWatching(i));
  await Promise.all(projects.map((_, i) => refreshState(i, { force: true }).catch(logErr)));
  console.log(`Lanes dashboard: http://127.0.0.1:${PORT}/`);
  for (const p of projects) console.log(`  ${p.name}: ${p.lanesFolder}${fs.existsSync(p.lanesFolder) ? '' : '  (not found)'}`);
});
