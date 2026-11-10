// Lanes dashboard v3: Needs you and Ready to merge on the left, the chat in the centre, sessions on the right.
// Everything from files is set as text, except plan/coordinator markdown,
// which the server renders with raw HTML escaped.

const SESSIONS = [
  { key: 'coordinator', name: 'Coordinator' },
  { key: 'lane-a', name: 'Lane A' },
  { key: 'lane-b', name: 'Lane B' },
  { key: 'lane-c', name: 'Lane C' },
];
const STALE_MS = 15 * 60 * 1000; // a board not updated for 15 min is "stale"
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const NEAR_BOTTOM_PX = 120;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const EM_DASH = new RegExp(`\\s*${String.fromCharCode(8212)}\\s*`, 'g');
const noEmDash = (s) => String(s ?? '').replace(EM_DASH, ', ');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const sessionOf = (key) => SESSIONS.find((s) => s.key === key);
const keyOfName = (name) => SESSIONS.find((s) => s.name.toLowerCase() === String(name || '').toLowerCase())?.key || null;
const dot = (key) => h('span', { class: `dot ${key || ''}`, 'aria-hidden': 'true' });

function fmtTime(t) {
  if (t == null) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtDay(t) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtAgo(t) {
  if (t == null) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
const ago = (t, prefix = '') => h('span', { dataset: { ago: String(t ?? ''), prefix } }, t == null ? '' : prefix + fmtAgo(t));

// Text with `code` spans and #123 PR links, all as text nodes.
function richText(text) {
  const out = [];
  const re = /`([^`]+)`|(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])|#(\d{2,7})\b/g;
  const str = noEmDash(text);
  let last = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index));
    if (m[1] != null) out.push(h('code', null, m[1]));
    else if (m[2] != null) out.push(h('a', { href: m[2], target: '_blank', rel: 'noreferrer' }, m[2]));
    else {
      const pr = state?.prs?.[m[3]];
      out.push(pr && pr.ok && pr.url ? h('a', { href: pr.url, target: '_blank', rel: 'noreferrer' }, `#${m[3]}`) : `#${m[3]}`);
    }
    last = re.lastIndex;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}
function isNone(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/[.\s]+$/, '');
  return !s || s === 'none' || s === 'nothing' || s === 'n/a' || s === '-' || /^none[\s,;(]/.test(s);
}
const prNums = (text) => [...new Set([...String(text || '').matchAll(/#(\d{2,7})\b/g)].map((m) => Number(m[1])))];

// ---------- app state ----------
let state = null;
let projectIndex = Number(new URLSearchParams(location.search).get('p') ?? store.get('project', 0)) || 0;
let drawerKey = null;
let firstChatRender = true;
let lastChatKey = '';
const expanded = new Set();
const composers = new Map();

// ---------- composer ----------
class Composer {
  constructor(key, { placeholder, replyTo }) {
    this.key = key;
    this.replyTo = replyTo || null;
    this.choice = null;
    this.choiceText = '';
    this.images = [];
    this.sending = false;
    this.optionButtons = [];
    this.onSent = null;

    this.textarea = h('textarea', { rows: '1', placeholder, 'aria-label': placeholder });
    this.thumbs = h('div', { class: 'thumbs', hidden: true });
    this.hint = h('span', { class: 'hint' }, 'Enter sends, Shift+Enter new line');
    this.mic = SpeechRecognition
      ? h('button', { type: 'button', class: 'icon-btn', title: 'Dictate', 'aria-label': 'Dictate', 'aria-pressed': 'false', onclick: () => this.toggleMic() }, icon('mic'))
      : null;
    this.file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { this.addFiles([...this.file.files]); this.file.value = ''; } });
    this.attach = h('button', { type: 'button', class: 'icon-btn', title: 'Add an image (or paste or drop one)', 'aria-label': 'Add image', onclick: () => this.file.click() }, icon('plus'));
    this.sendBtn = h('button', { type: 'button', class: 'send-btn', title: 'Send (Enter)', 'aria-label': 'Send', onclick: () => this.send() }, icon('send'));
    this.model = h('span', { class: 'composer-model', hidden: true });
    this.el = h('div', { class: 'composer' }, this.thumbs, this.textarea,
      h('div', { class: 'composer-bar' }, this.file, this.attach, this.mic, this.hint, this.model, this.sendBtn));

    this.textarea.addEventListener('input', () => { this.autosize(); if (this.listening && !this.applyingSpeech) this.stopMic(); });
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); this.send(); }
    });
    this.textarea.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); this.addFiles(files); }
    });
    this.el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); this.el.classList.add('drag'); } });
    this.el.addEventListener('dragleave', (e) => { if (!this.el.contains(e.relatedTarget)) this.el.classList.remove('drag'); });
    this.el.addEventListener('drop', (e) => {
      this.el.classList.remove('drag');
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); this.addFiles(files); }
    });
  }

  autosize() {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 260)}px`;
  }

  // The model the Coordinator runs, read-only (shown in the main box only).
  setModel(m) {
    this.model.hidden = !m;
    this.model.textContent = m ? m.label : '';
    this.model.title = m ? `The Coordinator runs ${m.model}. Change it with /model in its terminal.` : '';
  }

  setError(msg) {
    this.hint.className = msg ? 'err' : 'hint';
    this.hint.textContent = msg || 'Enter sends, Shift+Enter new line';
  }

  setStatus(msg) {
    this.hint.className = 'hint live-hint';
    this.hint.textContent = msg;
  }

  chooseOption(idx, text) {
    const cur = this.textarea.value;
    let rest = cur;
    if (this.choiceText && cur.startsWith(this.choiceText)) rest = cur.slice(this.choiceText.length);
    else if (cur.trim()) rest = ` ${cur.trim()}`;
    if (this.choice === idx) {
      this.choice = null; this.choiceText = '';
      this.textarea.value = rest.replace(/^[.,:;\s]+/, '');
    } else {
      this.choice = idx; this.choiceText = text;
      this.textarea.value = text + (rest.trim() ? rest : '');
    }
    this.syncOptions();
    this.autosize();
    this.textarea.focus();
    const end = this.textarea.value.length;
    this.textarea.setSelectionRange(end, end);
  }

  syncOptions() { this.optionButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(this.choice === i))); }

  async addFiles(files) {
    this.setError('');
    for (const f of files) {
      if (this.images.length >= 10) { this.setError('At most 10 images per message'); break; }
      try {
        const dataUrl = await toPngDataUrl(f);
        if (dataUrl.length * 0.75 > MAX_IMAGE_BYTES) { this.setError('That image is over 10 MB'); continue; }
        this.images.push({ dataUrl });
      } catch { this.setError('Could not read that image'); }
    }
    this.renderThumbs();
  }

  renderThumbs() {
    this.thumbs.replaceChildren(...this.images.map((img, i) => h('div', { class: 'thumb' },
      h('img', { src: img.dataUrl, alt: `Image ${i + 1}` }),
      h('button', { type: 'button', 'aria-label': `Remove image ${i + 1}`, title: 'Remove', onclick: () => { this.images.splice(i, 1); this.renderThumbs(); this.textarea.focus(); } }, '×'))));
    this.thumbs.hidden = this.images.length === 0;
    this.el.classList.toggle('has-images', this.images.length > 0);
  }

  toggleMic() { this.listening ? this.stopMic() : this.startMic(); }

  startMic() {
    for (const c of composers.values()) if (c !== this && c.listening) c.stopMic();
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-NZ';
    // Final words are fixed once heard: they are kept by result index and never rewritten.
    // Only the phrase still being heard (interim) changes, and it always sits after them.
    const dict = new Dictation(this.textarea.value);
    // What happened, so a silent failure can say why. Every event also goes to the console.
    const seen = { audio: false, sound: false, results: 0, words: 0, error: null };
    const log = (...a) => console.info('[dictation]', ...a);
    const live = () => this.rec === rec; // false once stopped: late events are dropped
    log('start', { lang: rec.lang, browser: navigator.userAgent });
    rec.onaudiostart = () => { if (!live()) return; seen.audio = true; log('audiostart'); this.setStatus('Listening. Speak now.'); };
    rec.onsoundstart = () => { if (live()) { seen.sound = true; log('soundstart'); } };
    rec.onspeechstart = () => { if (live()) log('speechstart'); };
    rec.onnomatch = () => { if (live()) log('nomatch'); };
    rec.onresult = (e) => {
      if (!live()) { log('late result dropped'); return; }
      const results = [...e.results].map((r) => ({ final: r.isFinal, text: (r[0]?.transcript || '').trim() }));
      for (let i = e.resultIndex; i < results.length; i++) {
        seen.results++;
        if (results[i].text) seen.words++;
        log('result', { i, final: results[i].final, text: results[i].text });
      }
      if (!dict.apply(e.resultIndex, results)) return; // nothing new: leave the box alone
      this.showDictation(dict.text());
    };
    rec.onerror = (e) => { if (!live()) return; seen.error = e.error; log('error', e.error, e.message || ''); };
    rec.onend = () => {
      log('end', seen);
      if (!live()) return; // stopped by the person: already tidied up
      this.rec = null;
      this.dict = null;
      this.micOff();
      this.setError(dictationProblem(seen));
    };
    try { rec.start(); } catch (err) { log('start threw', String(err)); this.setError('Dictation could not start. Try Windows voice typing: press Win+H in the box.'); return; }
    this.rec = rec;
    this.dict = dict;
    this.seen = seen;
    this.listening = true;
    this.setStatus('Starting the microphone');
    this.mic.classList.add('listening');
    this.mic.setAttribute('aria-pressed', 'true');
    this.mic.title = 'Stop dictating';
    this.textarea.focus();
  }

  showDictation(value) {
    this.applyingSpeech = true;
    this.textarea.value = value;
    this.textarea.dispatchEvent(new Event('input'));
    this.applyingSpeech = false;
    const end = value.length;
    this.textarea.setSelectionRange(end, end);
  }

  micOff() {
    this.listening = false;
    this.mic.classList.remove('listening');
    this.mic.setAttribute('aria-pressed', 'false');
    this.mic.title = 'Dictate';
  }

  // Stop at once: abort (stop() waits for the service to finish), drop anything that
  // arrives afterwards, and keep what the box shows now.
  stopMic() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    this.dict = null;
    try { rec.abort(); } catch { /* already ended */ }
    console.info('[dictation]', 'stopped by you', this.seen);
    this.micOff();
    // Words came through, or nothing came back yet: no message. Empty results or an error: say why.
    const seen = this.seen;
    this.seen = null;
    this.setError(seen && !seen.words && (seen.results || seen.error) ? dictationProblem(seen) : '');
  }

  async send() {
    if (this.sending) return;
    if (this.listening) this.stopMic();
    const text = this.textarea.value.trim();
    if (!text && !this.images.length) { this.setError('Type, dictate or paste something first'); return; }
    const body = { project: projectIndex, to: 'Coordinator', text, images: this.images.map((i) => i.dataUrl) };
    if (this.replyTo) body.replyTo = this.replyTo;
    if (this.choice != null && text.startsWith(this.choiceText)) body.choice = this.choice;
    this.sending = true;
    this.sendBtn.disabled = true;
    this.sendBtn.setAttribute('aria-busy', 'true');
    this.setError('');
    try {
      const res = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
      this.textarea.value = '';
      this.images = [];
      this.choice = null; this.choiceText = '';
      this.syncOptions();
      this.renderThumbs();
      this.autosize();
      stickToBottom = true;
    } catch (e) {
      this.setError(e.message || 'Send failed');
    } finally {
      this.sending = false;
      this.sendBtn.disabled = false;
      this.sendBtn.removeAttribute('aria-busy');
    }
  }
}

// The text of one dictation run: what was in the box before, the final phrases by result
// index (fixed once final), and the one phrase still being heard. If the browser starts a
// fresh results list (shorter than before), the finals so far are folded into the fixed part.
class Dictation {
  constructor(before) {
    this.fixed = before;
    this.finals = new Map();
    this.interim = '';
    this.lastLength = 0;
  }

  apply(resultIndex, results) {
    if (results.length < this.lastLength) { this.fixed = this.text(false); this.finals.clear(); }
    this.lastLength = results.length;
    let changed = false;
    let interim = '';
    for (let i = resultIndex; i < results.length; i++) {
      const r = results[i];
      if (r.final) {
        if (r.text && !this.finals.has(i)) { this.finals.set(i, r.text); changed = true; }
      } else if (r.text) interim += ` ${r.text}`;
    }
    interim = interim.trim();
    // An empty interim with no new final is the service between phrases: keep showing the last one.
    if (interim && interim !== this.interim) { this.interim = interim; changed = true; }
    if (changed && !interim) this.interim = '';
    return changed;
  }

  text(withInterim = true) {
    const parts = [...this.finals.keys()].sort((a, b) => a - b).map((k) => this.finals.get(k));
    if (withInterim && this.interim) parts.push(this.interim);
    const said = parts.join(' ');
    if (!said) return this.fixed;
    return this.fixed + (this.fixed && !/\s$/.test(this.fixed) ? ' ' : '') + said;
  }
}

// Why a dictation run ended without words, in plain language; '' when it worked or was stopped.
// The browser sends the audio to its own online speech service (Microsoft for Edge, Google for
// Chrome); the page only gets back what that service returns.
const WIN_H = 'Windows voice typing works instead: click in the box and press Win+H.';
function dictationProblem(seen) {
  const e = seen.error;
  if (e === 'not-allowed') return 'Microphone blocked. Allow it from the icon in the address bar, then try again.';
  if (e === 'service-not-allowed') return `The browser's speech service is turned off. ${WIN_H}`;
  if (e === 'audio-capture') return 'No microphone found. Check Windows sound settings, then try again.';
  if (e === 'network') return `The browser could not reach its online speech service. ${WIN_H}`;
  if (e === 'language-not-supported') return `The speech service does not support ${navigator.language}. ${WIN_H}`;
  if (e === 'no-speech') return 'Heard nothing. Check the right microphone is selected, then try again.';
  if (e && e !== 'aborted') return `Dictation stopped (${e}). ${WIN_H}`;
  if (seen.words) return '';
  if (!seen.audio) return `The microphone never started. ${WIN_H}`;
  if (seen.results) return `The speech service heard you but sent back no words. ${WIN_H}`;
  if (!seen.sound) return 'No sound reached the page. Check the right microphone is selected.';
  return `No words came back. ${WIN_H}`;
}

function composer(key, opts) {
  let c = composers.get(key);
  if (!c) { c = new Composer(key, opts); composers.set(key, c); }
  return c;
}

async function toPngDataUrl(file) {
  if (file.type === 'image/png') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return canvas.toDataURL('image/png');
}

const ICONS = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  prev: '<path d="m14.5 6-6 6 6 6"/>',
  next: '<path d="m9.5 6 6 6-6 6"/>',
};
function icon(name) {
  const s = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`, 'image/svg+xml');
  return document.importNode(s.documentElement, true);
}

function attachmentThumbs(r) {
  if (!r.attachments || !r.attachments.length) return null;
  return h('div', { class: 'reply-thumbs' }, r.attachments.map((name) => {
    const src = `/api/attachment?p=${projectIndex}&name=${encodeURIComponent(name)}`;
    return h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: 'Attached image', loading: 'lazy' }));
  }));
}

// ---------- PR state ----------
// Shows only what GitHub actually answered; nothing when the lookup failed.
function ciMini(p) {
  if (!p || !p.ok) return null;
  if (p.state === 'MERGED') return h('span', { class: 'mini' }, 'Merged');
  if (p.state === 'CLOSED') return h('span', { class: 'mini' }, 'Closed');
  const label = { pass: 'CI pass', pending: 'CI pending', fail: 'CI fail' }[p.ci];
  return [
    label ? h('span', { class: `mini ${p.ci}`, title: (p.checks || []).map((c) => `${c.name}: ${c.bucket}`).join('\n') }, dot(), label) : null,
    p.greptile == null ? null : h('span', { class: 'mini', title: 'Greptile confidence score' }, `Greptile ${p.greptile}/5`),
  ];
}

function prRow(n) {
  const p = state.prs?.[n];
  if (!p || !p.ok) return h('div', { class: 'pr unavailable' }, h('span', { class: 'pr-num' }, `#${n}`), h('span', null, p ? 'PR state unavailable' : (state.prsFetching || !state.prsFetchedAt ? 'Checking' : 'PR state unavailable')));
  const st = p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : 'open';
  return h('div', { class: 'pr' },
    h('a', { class: 'pr-num', href: p.url, target: '_blank', rel: 'noreferrer' }, `#${n}`),
    h('span', { class: `pr-state ${st}` }, st === 'merged' ? 'Merged' : st === 'closed' ? 'Closed' : p.draft ? 'Draft' : 'Open'),
    st === 'open' ? [ciMini(p), h('span', { class: 'mini' }, p.threads == null ? 'Threads unknown' : p.threads === 1 ? '1 open thread' : `${p.threads} open threads`)] : null,
    h('span', { class: 'pr-title', title: noEmDash(p.title) }, noEmDash(p.title)));
}
const isGone = (n) => { const p = state.prs?.[n]; return !!(p && p.ok && (p.state === 'MERGED' || p.state === 'CLOSED')); };
const shortTitle = (t) => noEmDash(String(t || '').replace(/^\w+(\([^)]*\))?!?:\s*/, ''));
// The person the sessions work for (config "person"); their lines show as "You".
const isPerson = (u) => String(u.from).toLowerCase() === String(state.person || 'User').toLowerCase();
const toPerson = (u) => String(u.to).toLowerCase() === String(state.person || 'User').toLowerCase();
const NOT_CHAT = new Set(['question', 'done', 'merge-order', 'todo']);

// ---------- Needs you (left, top) ----------
function aboutChip(u) {
  const key = u.aboutKey || (u.fromKey && u.fromKey !== 'coordinator' ? u.fromKey : null);
  if (key) return h('span', { class: 'chip-about' }, dot(key), sessionOf(key).name);
  if (u.about) return h('span', { class: 'chip-about' }, u.about);
  if (u.pr) return h('span', { class: 'chip-about' }, `#${u.pr}`);
  return null;
}


// Multi-line text: plain lines as paragraphs, "- " lines as a bullet list.
function block(text) {
  const out = [];
  let list = null;
  for (const raw of noEmDash(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      if (!list) { list = h('ul', { class: 'blk-ul' }); out.push(list); }
      list.append(h('li', null, richText(m[1])));
    } else {
      list = null;
      if (raw.trim()) out.push(h('div', { class: 'blk-p' }, richText(raw)));
    }
  }
  return out;
}

// Card head: the title (or the text's first sentence) and the rest as the why.
function splitTitle(u) {
  const text = noEmDash(u.text || '').trim();
  if (u.title) return { title: noEmDash(u.title), why: text };
  const m = text.match(/^([\s\S]+?[.!?])(\s+[\s\S]*)?$/);
  if (m && m[1].length <= 200) return { title: m[1], why: (m[2] || '').trim() };
  return { title: '', why: text };
}

// Numbered steps; a step's "\n- " lines become indented sub-bullets.
function stepsList(steps) {
  if (!steps || !steps.length) return null;
  return h('ol', { class: 'steps' }, steps.map((step) => {
    const [first, ...rest] = noEmDash(step).split(/\r?\n/);
    const subs = rest.map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1] ?? l.trim()).filter(Boolean);
    return h('li', null, richText(first), subs.length ? h('ul', null, subs.map((x) => h('li', null, richText(x)))) : null);
  }));
}

function cardBody(u, { clampId, rerender }) {
  const { title, why } = splitTitle(u);
  const long = why.length > 360 || why.split('\n').length > 6;
  const open = expanded.has(clampId);
  return [
    title ? h('div', { class: 'card-title' }, richText(title)) : null,
    why ? h('div', { class: `msg-text card-why ${long && !open ? 'clamp' : ''}` }, block(why)) : null,
    long ? h('button', { type: 'button', class: 'more', onclick: () => { open ? expanded.delete(clampId) : expanded.add(clampId); rerender(); } }, open ? 'Show less' : 'Show all') : null,
    stepsList(u.steps),
    u.sql?.length ? sqlPager(u, rerender) : null,
  ];
}

// ---------- SQL queries on a card: one at a time, arrows to flip ----------
const sqlIdx = new Map(); // card id -> index shown

function sqlPager(u, rerender) {
  const n = u.sql.length;
  const key = u.id || `line:${u.line}`;
  const i = Math.min(sqlIdx.get(key) ?? 0, n - 1);
  const q = u.sql[i];
  const go = (d) => { const j = i + d; if (j < 0 || j >= n) return; sqlIdx.set(key, j); rerender(); };
  // Titles may already say "3 of 6: ..."; show our own count once.
  const title = q.title.replace(/^\s*\d+\s*(of|\/)\s*\d+\s*[:.)-]?\s*/i, '');
  const copy = h('button', { type: 'button', class: 'btn sql-copy' }, icon('copy'), 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(q.query);
      copy.replaceChildren(icon('check'), 'Copied');
      setTimeout(() => copy.replaceChildren(icon('copy'), 'Copy'), 1500);
    } catch { copy.replaceChildren(icon('copy'), 'Could not copy'); }
  });
  return h('section', { class: 'sql', 'aria-label': 'SQL queries' },
    h('div', { class: 'sql-head' },
      h('span', { class: 'sql-title' }, n > 1 ? `${i + 1} of ${n}${title ? ': ' : ''}` : '', title),
      n > 1 ? h('span', { class: 'sql-pager' },
        h('button', { type: 'button', class: 'icon-btn pager-btn', title: 'Previous query (Left arrow)', 'aria-label': 'Previous query', disabled: i === 0 ? true : null, onclick: () => go(-1) }, icon('prev')),
        h('span', { class: 'pager-pos' }, `${i + 1} / ${n}`),
        h('button', { type: 'button', class: 'icon-btn pager-btn', title: 'Next query (Right arrow)', 'aria-label': 'Next query', disabled: i === n - 1 ? true : null, onclick: () => go(1) }, icon('next'))) : null),
    h('div', { class: 'sql-box' }, h('pre', { class: 'sql-code' }, h('code', null, sqlHighlight(q.query))), copy),
    q.expect ? h('div', { class: 'sql-expect' }, h('b', null, 'Expect: '), q.expect) : null);
}

// Left/Right flip queries while a card with SQL is open in the modal,
// unless the focus is in a text box.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!$('#card-modal').open || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const btn = $(`#card-modal-body .sql-pager [aria-label="${e.key === 'ArrowRight' ? 'Next' : 'Previous'} query"]`);
  if (!btn || btn.disabled) return;
  e.preventDefault();
  btn.click();
});

const SQL_WORDS = new Set(('select from where and or not null is in as on join left right inner outer full cross using group by order having limit offset ' +
  'insert into values update set delete returning create alter drop table column index unique primary key foreign references constraint default check ' +
  'add if exists begin commit rollback transaction case when then else end distinct union all with comment grant revoke to view sequence ' +
  'cascade restrict trigger function procedure language replace true false like ilike between asc desc boolean text integer int bigint ' +
  'smallint serial bigserial varchar char numeric decimal real double precision timestamp timestamptz date time interval uuid jsonb json ' +
  'bytea array do nothing conflict lateral filter over partition window rename type enum schema extension coalesce count sum min max now').split(' '));

// A small tokenizer: comments, strings, quoted names, numbers, keywords. The
// text of every token is kept as is, so the query reads exactly as written.
function sqlHighlight(src) {
  const out = [];
  const re = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\$\$[\s\S]*?\$\$)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([^A-Za-z0-9_'"$-]+|[\s\S])/g;
  let m;
  while ((m = re.exec(src))) {
    const [t, com, s, ident, dollar, num, word] = m;
    if (com) out.push(h('span', { class: 'sq-com' }, t));
    else if (s || dollar) out.push(h('span', { class: 'sq-str' }, t));
    else if (ident) out.push(h('span', { class: 'sq-id' }, t));
    else if (num) out.push(h('span', { class: 'sq-num' }, t));
    else if (word && SQL_WORDS.has(word.toLowerCase())) out.push(h('span', { class: 'sq-kw' }, t));
    else out.push(t);
  }
  return out;
}

function questionCard(q) {
  const open = q.status === 'open';
  const c = composer(`q:${q.id}`, { placeholder: 'Reply or dictate', replyTo: q.id });
  if (open) {
    c.optionButtons = q.options.map((opt, i) => h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: () => c.chooseOption(i, opt) }, opt));
    c.syncOptions();
  }
  const last = q.replies?.at(-1);
  return h('article', { class: `qcard ${open ? 'open' : 'closed'}`, id: `q-${q.id}`, dataset: { open: open ? '1' : '' } },
    h('div', { class: 'msg-meta' }, kindTag('decide'), aboutChip(q), tagChips(q), h('span', { class: 'time', title: q.ts }, fmtTime(q.t))),
    cardBody(q, { clampId: `qx:${q.id}`, rerender: renderNeeds }),
    open && c.optionButtons.length ? h('div', { class: 'options' }, c.optionButtons) : null,
    open ? c.el : h('div', { class: `qstatus ${q.status === 'settled' ? 'settled' : ''}` },
      q.status === 'settled' ? 'Settled' : 'Answered, waiting for Coordinator',
      last && last.choice != null && q.options[last.choice] ? `. You chose "${q.options[last.choice]}"` : ''));
}

// Needs you is a list of titles, one line each. Clicking one opens the full
// card (text, steps, options or Done) in a modal. modalKey is the open card.
let modalKey = null;

function needsModel() {
  const qs = state.needs.questions;
  const open = qs.filter((q) => q.status === 'open').sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const recentQs = qs.filter((q) => q.status !== 'open' && (q.status === 'sent' || (q.done?.t != null && Date.now() - q.done.t < 2 * 3600e3)));
  const todos = todoModel();
  const rank = (u) => (u.tags?.includes('urgent') ? 0 : u.tags?.includes('blocking') ? 1 : 2);
  const items = [
    ...open.map((q) => ({ key: `q:${q.id}`, u: q, kind: 'decide', card: () => questionCard(q) })),
    ...todos.active.map((t) => ({ key: `t:${t.id}`, u: t, kind: 'todo', card: () => todoCard(t, 'active') })),
  ].sort((a, b) => rank(a.u) - rank(b.u) || (b.u.t ?? 0) - (a.u.t ?? 0));
  const recent = [
    ...recentQs.map((q) => ({ key: `q:${q.id}`, u: q, kind: 'decide', done: true, at: q.done?.t ?? q.replies?.at(-1)?.t ?? q.t, card: () => questionCard(q) })),
    ...todos.closed.slice(0, 20).map((c) => ({ key: `t:${c.t.id}`, u: c.t, kind: 'todo', done: true, at: c.at, card: () => todoCard(c.t, 'closed') })),
  ].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return { open, todos, items, recent };
}

// Tags from the line ("tags":["urgent"]), plus "after merge" for after:"merge" to dos.
function tagsOf(u) {
  const tags = [...(u.tags || [])];
  if (u.after === 'merge' && !tags.includes('after merge')) tags.push('after merge');
  return tags;
}
function tagChips(u) {
  return tagsOf(u).map((t) => h('span', { class: `tag-chip tag-${t.replace(/[^a-z0-9]+/g, '-')}` }, t));
}

const kindTag = (kind) => h('span', { class: `ntag ${kind === 'decide' ? 'decide' : 'todo-tag'}` }, kind === 'decide' ? 'Question' : 'To do');

// The compact card: kind, lane, PR, tags and the whole title. Click for the rest.
function needCard(it) {
  const { title, why } = splitTitle(it.u);
  const text = title || why.split('\n')[0] || '(no text)';
  const open = () => openCard(it.key);
  return h('div', {
    class: `need-card ${it.done ? 'done' : ''} ${needsFlash?.key === it.key && Date.now() < needsFlash.until ? 'flash' : ''}`, role: 'button',
    style: needsFlash?.key === it.key ? `animation-delay: -${Math.max(0, 2500 - (needsFlash.until - Date.now()))}ms` : null, tabindex: '0', title: 'Open the full card',
    onclick: (e) => { if (!e.target.closest('a')) open(); },
    onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  },
    h('div', { class: 'need-meta' }, kindTag(it.kind), aboutChip({ ...it.u, pr: null }), it.u.pr ? prLink(it.u.pr) : null, tagChips(it.u)),
    h('div', { class: 'need-title' }, richText(text)));
}

// Needs you shows one card at a time. needsCur is the shown card's key; when it
// goes (answered, Done), the card that moves into its place shows: the next one.
let needsCur = null;
let needsIdx = 0;
let needsSeen = null; // keys already shown; null until the first render
let needsFlash = null; // { key, until }
function needsPage(delta) { needsIdx += delta; needsCur = null; renderNeeds(); }

function needRow(it) {
  const { title, why } = splitTitle(it.u);
  const text = title || why.split('\n')[0] || '(no text)';
  return h('button', { type: 'button', class: 'need-row done', title: text, onclick: () => openCard(it.key) },
    kindTag(it.kind), h('span', { class: 'need-title' }, noEmDash(text)));
}

function renderNeeds() {
  const { open, todos, items, recent } = needsModel();
  const total = items.length;
  $('#needs-panel').classList.toggle('has', total > 0);
  const count = $('#needs-count');
  count.hidden = total === 0;
  count.textContent = String(total);
  count.title = `${open.length} to decide, ${todos.active.length} to do`;
  const tc = $('#tab-count');
  tc.hidden = total === 0;
  tc.textContent = String(total);
  document.title = total ? `(${total}) Lanes` : 'Lanes';

  // A card that was not there before: show it (the highest placed if several) and flash it.
  if (needsSeen) {
    const fresh = items.find((c) => !needsSeen.has(c.key));
    if (fresh) {
      needsCur = fresh.key;
      needsFlash = { key: fresh.key, until: Date.now() + 2500 };
      setTimeout(() => { if (needsFlash && Date.now() >= needsFlash.until) { needsFlash = null; renderNeeds(); } }, 2600);
    }
  }
  needsSeen = new Set(items.map((c) => c.key));
  const at = items.findIndex((c) => c.key === needsCur);
  needsIdx = Math.max(0, Math.min(at >= 0 ? at : needsIdx, items.length - 1));
  needsCur = items[needsIdx]?.key ?? null;
  const pager = $('#needs-pager');
  pager.hidden = items.length < 2;
  if (items.length > 1) {
    pager.replaceChildren(
      h('button', { type: 'button', class: 'icon-btn pager-btn', title: 'Previous', 'aria-label': 'Previous card', disabled: needsIdx === 0 ? true : null, onclick: () => needsPage(-1) }, icon('prev')),
      h('span', { class: 'pager-pos', 'aria-live': 'polite' }, `${needsIdx + 1} of ${items.length}`),
      h('button', { type: 'button', class: 'icon-btn pager-btn', title: 'Next', 'aria-label': 'Next card', disabled: needsIdx === items.length - 1 ? true : null, onclick: () => needsPage(1) }, icon('next')));
  }
  const nodes = items.length ? [needCard(items[needsIdx])] : [h('div', { class: 'nothing' }, 'Nothing needs you.')];
  if (recent.length) {
    const showing = expanded.has('recent');
    nodes.push(h('button', { type: 'button', class: 'more', style: 'color:var(--text-2)', onclick: () => { showing ? expanded.delete('recent') : expanded.add('recent'); renderNeeds(); } },
      `${showing ? 'Hide' : 'Show'} recently done (${recent.length})`));
    if (showing) nodes.push(...recent.map(needRow));
  }
  $('#needs-list').replaceChildren(...nodes);
  renderCardModal();
}

function openCard(key) {
  const { items } = needsModel();
  modalLive = !key.startsWith('r:') && items.some((x) => x.key === key);
  modalKey = key;
  renderCardModal();
  const d = $('#card-modal');
  if (!d.open) d.showModal();
}

// Re-rendered with every update while open. A card opened while waiting on
// you closes the modal once it is answered or marked Done (it leaves the list).
let modalLive = false;
function renderCardModal() {
  if (!modalKey) return;
  if (modalKey.startsWith('r:')) {
    $('#card-modal-title').textContent = 'Ready to merge';
    $('#card-modal-body').replaceChildren(readyDetail(Number(modalKey.slice(2))));
    return;
  }
  $('#card-modal-title').textContent = 'Needs you';
  const { items, recent } = needsModel();
  const live = items.find((x) => x.key === modalKey);
  if (modalLive && !live) { $('#card-modal').close(); return; }
  const it = live || recent.find((x) => x.key === modalKey);
  if (!it) { $('#card-modal').close(); return; }
  $('#card-modal-body').replaceChildren(it.card());
}
// ---------- To do cards (inside Needs you) ----------
// A todo stays until the person presses Done (an answer with done:true) or the
// Coordinator sends a done line for it. "after":"merge" waits for its PR.
function todoModel() {
  const seen = new Set();
  const active = [];
  const waiting = [];
  const closed = [];
  const todos = state.updates.filter((u) => u.kind === 'todo' && u.id && !seen.has(u.id) && seen.add(u.id)).reverse(); // oldest first
  for (const t of todos) {
    const mine = state.answers.find((a) => a.replyTo === t.id && a.done);
    const coord = state.updates.find((u) => u.kind === 'done' && u.replyTo === t.id);
    if (mine || coord) { closed.push({ t, at: (mine || coord).t }); continue; }
    const waitsForMerge = t.after === 'merge' && t.pr && state.prs?.[t.pr]?.state !== 'MERGED';
    (waitsForMerge ? waiting : active).push(t);
  }
  return { active, waiting, closed: closed.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) };
}

function todoCard(t, mode) {
  const err = h('span', { class: 'err' });
  const btn = mode === 'active' ? h('button', {
    type: 'button', class: 'btn primary', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Saving'; err.textContent = '';
      try {
        const res = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectIndex, to: 'Coordinator', replyTo: t.id, done: true, text: 'Done' }) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Done'; }
    },
  }, 'Done') : null;
  return h('article', { class: `todo ${mode}`, id: `todo-${t.id}` },
    h('div', { class: 'msg-meta' }, kindTag('todo'), aboutChip({ ...t, pr: null }), t.pr ? prLink(t.pr) : null, tagChips(t),
      mode === 'waiting' ? h('span', null, `after #${t.pr} merges`) : null,
      h('span', { class: 'time', title: t.ts }, fmtTime(t.t))),
    cardBody(t, { clampId: `tx:${t.id}`, rerender: renderNeeds }),
    mode === 'active' ? h('div', { class: 'todo-foot' }, err, btn) : null,
    mode === 'closed' ? h('div', { class: 'qstatus settled' }, 'Done') : null);
}

// ---------- Ready to merge (left, bottom) ----------
function ownerOf(n) {
  const lanes = state.updates.filter((u) => u.kind === 'ready' && u.pr === n && u.fromKey && u.fromKey !== 'coordinator');
  if (lanes.length) return lanes[0].fromKey; // updates are newest first
  for (const s of SESSIONS.slice(1)) {
    const st = state.sessions[s.key];
    if (st?.exists && prNums(st.fields?.['Open PRs']).includes(n)) return s.key;
  }
  return null;
}

// The plain name for a PR: the newest Coordinator merge-order label, else the GitHub title.
function prLabel(n) {
  const mo = state.updates.find((u) => u.kind === 'merge-order' && u.fromKey === 'coordinator' && u.labels?.[n]);
  return mo ? noEmDash(mo.labels[n]) : null;
}

// Open to dos for a PR, newest first. after:"merge" ones are what to check once it merges.
function prTodos(n) {
  const closed = new Set(todoModel().closed.map((c) => c.t.id));
  const seen = new Set();
  return state.updates.filter((u) => u.kind === 'todo' && u.pr === n && u.id && !closed.has(u.id) && !seen.has(u.id) && seen.add(u.id));
}

function todoBlock(t, idPrefix) {
  return h('div', { class: 'r-todo' }, tagsOf(t).length ? h('div', { class: 'need-meta' }, tagChips(t)) : null, cardBody(t, { clampId: `${idPrefix}:${t.id}`, rerender: renderCardModal }));
}

function readyTitle(n) {
  const p = state.prs?.[n];
  const laneLine = state.updates.find((u) => u.kind === 'ready' && u.pr === n && u.fromKey !== 'coordinator');
  return prLabel(n) || (p && p.ok ? shortTitle(p.title) : (laneLine ? noEmDash(laneLine.text).slice(0, 80) : ''));
}

function readyRow(n, ord) {
  const p = state.prs?.[n];
  const owner = ownerOf(n);
  const title = readyTitle(n);
  const open = () => openCard(`r:${n}`);
  return h('div', {
    class: 'ready', role: 'button', tabindex: '0', title: 'Open what it does and what to check',
    onclick: (e) => { if (!e.target.closest('a')) open(); },
    onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  },
    h('span', { class: 'ord' }, ord == null ? '' : String(ord)),
    h('span', { class: 'r-top' },
      p && p.ok ? h('a', { class: 'num', href: p.url, target: '_blank', rel: 'noreferrer' }, `#${n}`) : h('span', { class: 'num' }, `#${n}`),
      h('span', { class: 'title', title }, title)),
    h('span', { class: 'r-bottom' },
      owner ? h('span', { class: 'owner' }, dot(owner), sessionOf(owner).name) : null,
      ciMini(p)));
}

// The modal for a ready PR: what it does, to dos before and after merging, the link.
function readyDetail(n) {
  const p = state.prs?.[n];
  const owner = ownerOf(n);
  const coordLine = state.updates.find((u) => u.kind === 'ready' && u.pr === n && u.fromKey === 'coordinator');
  const laneLine = state.updates.find((u) => u.kind === 'ready' && u.pr === n && u.fromKey !== 'coordinator');
  const todos = prTodos(n);
  const afterMerge = todos.filter((t) => t.after === 'merge');
  const before = todos.filter((t) => t.after !== 'merge');
  const section = (label, kids) => h('div', { class: 'r-sec' }, h('div', { class: 'r-label' }, label), kids);
  const url = p?.url || null;
  return h('div', { class: 'ready-detail' },
    h('div', { class: 'need-meta' }, url ? h('a', { href: url, target: '_blank', rel: 'noreferrer' }, `#${n}`) : h('span', null, `#${n}`),
      owner ? h('span', { class: 'chip-about' }, dot(owner), sessionOf(owner).name) : null, ciMini(p)),
    h('div', { class: 'card-title' }, readyTitle(n)),
    section('What it does', coordLine || laneLine ? h('div', { class: 'msg-text blk' }, block((coordLine || laneLine).text)) : h('div', { class: 'muted' }, 'No summary yet.')),
    before.length ? section('Before you merge', before.map((t) => todoBlock(t, 'rb'))) : null,
    afterMerge.length ? section('Check on staging after merging', afterMerge.map((t) => todoBlock(t, 'ra'))) : null,
    url ? h('a', { href: url, target: '_blank', rel: 'noreferrer', class: 'gh-link' }, `Open #${n} on GitHub`) : null);
}

function renderReady() {
  const mo = state.updates.find((u) => u.kind === 'merge-order' && u.fromKey === 'coordinator');
  // Exactly the latest merge order, keeping its numbers (a merged PR drops out, the others keep theirs).
  const ordered = (mo ? mo.prs.map((n, i) => ({ n, ord: i + 1 })) : []).filter((x) => !isGone(x.n));
  const nodes = [];
  ordered.forEach((x) => nodes.push(readyRow(x.n, x.ord)));
  if (!ordered.length) nodes.push(h('div', { class: 'nothing' }, mo ? 'Nothing to merge' : 'Nothing to merge yet. The Coordinator has not sent a merge order.'));
  // Only a real problem is shown: one line, not one per PR.
  if (state.prsError) nodes.push(h('div', { class: 'open-total', title: 'CI and review scores show again once GitHub answers.' }, `${state.prsError}; CI not shown.`));
  const rc = $('#ready-count');
  rc.textContent = ordered.length ? `(${ordered.length})` : '';
  $('#ready-list').replaceChildren(...nodes);
  renderPrAge();
}

function renderPrAge() {
  if (!state) return;
  $('#pr-age').textContent = state.prsFetching ? 'Checking' : state.prsFetchedAt ? fmtAgo(state.prsFetchedAt) : '';
  $('#pr-refresh').disabled = !!state.prsFetching;
  $('#pr-refresh').title = state.prsFetching ? 'Checking PRs' : state.prsFetchedAt ? `PRs checked ${fmtAgo(state.prsFetchedAt)}` : '';
  $('#pr-refresh').textContent = state.prsFetching ? 'Checking' : 'Refresh';
}

// ---------- Chat (centre) ----------
function chatEntries() {
  const entries = [];
  for (const u of state.updates) {
    if (isPerson(u)) entries.push({ type: 'mine', m: u, t: u.t, order: u.line, key: `m:${u.line}` });
    else if (u.fromKey === 'coordinator' && toPerson(u) && !NOT_CHAT.has(u.kind)) entries.push({ type: 'coord', u, t: u.t, order: u.line, key: `u:${u.line}` });
  }
  for (const a of state.answers.filter((x) => !x.done)) entries.push({ type: 'you', m: a, t: a.t, order: 1e6 + a.line, key: `a:${a.id}` });
  entries.sort((x, y) => {
    const tx = x.t ?? Infinity; const ty = y.t ?? Infinity;
    return tx !== ty ? tx - ty : x.order - y.order;
  });
  return entries;
}

// The person's latest message (page or terminal), and whether the Coordinator has answered it.
function latestMine() {
  const mine = [
    ...state.answers.filter((a) => a.t != null && !a.done).map((a) => ({ id: a.id, t: a.t, text: a.text, terminal: false })),
    ...state.updates.filter((u) => isPerson(u) && u.t != null).map((u) => ({ id: u.id || `m:${u.line}`, t: u.t, text: u.text, terminal: true })),
  ];
  if (!mine.length) return null;
  const m = mine.reduce((x, y) => (y.t > x.t ? y : x));
  const replied = state.updates.some((u) => u.fromKey === 'coordinator' && (
    (u.replyTo && u.replyTo === m.id) || (toPerson(u) && !NOT_CHAT.has(u.kind) && u.t != null && u.t > m.t)));
  return { ...m, replied };
}

function personMsg(m, { latest, terminal }) {
  let re = null;
  if (m.replyTo) {
    const q = state.updates.find((u) => u.kind === 'question' && u.id === m.replyTo);
    if (q) re = h('div', { class: 're' }, `Re: ${noEmDash(q.text)}`);
    else if (/^pr-\d+$/.test(m.replyTo)) re = h('div', { class: 're' }, `About #${m.replyTo.slice(3)}`);
  }
  const domId = terminal ? `m-${m.line}` : `a-${m.id}`;
  return h('div', { class: `msg you ${latest ? 'latest' : ''}`, id: domId },
    re,
    h('div', { class: 'bubble' },
      m.text ? h('div', { class: 'msg-text' }, noEmDash(m.text)) : null,
      terminal ? null : attachmentThumbs(m)),
    h('div', { class: 'msg-foot' },
      terminal ? h('span', { class: 'tag', title: 'Typed in the Coordinator\'s terminal' }, 'terminal') : null,
      !terminal && m.to && m.to !== 'Coordinator' ? h('span', null, `to ${m.to}`) : null,
      h('span', { class: 'time', title: m.ts }, fmtTime(m.t))));
}

function coordMsg(u) {
  return h('div', { class: 'msg coord' },
    u.text ? h('div', { class: 'msg-text blk' }, block(u.text)) : null,
    h('div', { class: 'msg-actions' },
      u.text ? copyButton(u.text) : null,
      ['ready', 'blocked'].includes(u.kind) ? h('span', { class: `kind kind-${u.kind}` }, u.kind) : null,
      tagChips(u),
      u.pr ? prLink(u.pr) : null,
      h('span', { class: 'time', title: `Coordinator, ${u.ts}` }, fmtTime(u.t))));
}

function copyButton(text) {
  const btn = h('button', { type: 'button', class: 'icon-btn mini-btn', title: 'Copy', 'aria-label': 'Copy message' }, icon('copy'));
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(noEmDash(text));
      btn.replaceChildren(icon('check'));
      btn.title = 'Copied';
      setTimeout(() => { btn.replaceChildren(icon('copy')); btn.title = 'Copy'; }, 1500);
    } catch { btn.title = 'Could not copy'; }
  });
  return btn;
}

function prLink(n) {
  const p = state.prs?.[n];
  return p && p.ok ? h('a', { href: p.url, target: '_blank', rel: 'noreferrer' }, `#${n}`) : h('span', null, `#${n}`);
}

let stickToBottom = true;
function renderChat() {
  const sc = $('#chat-scroll');
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < NEAR_BOTTOM_PX;
  const prevTop = sc.scrollTop;
  const entries = chatEntries();
  const latest = latestMine();
  composers.get('main')?.setModel(state.models?.Coordinator || null);
  const nodes = [];
  let lastDay = '';
  for (const e of entries) {
    if (e.t != null) {
      const day = new Date(e.t).toDateString();
      if (day !== lastDay) { nodes.push(h('div', { class: 'day' }, fmtDay(e.t))); lastDay = day; }
    }
    if (e.type === 'coord') nodes.push(coordMsg(e.u));
    else {
      const terminal = e.type === 'mine';
      const isLatest = latest && (terminal ? (e.m.id || `m:${e.m.line}`) === latest.id : e.m.id === latest.id);
      nodes.push(personMsg(e.m, { latest: isLatest, terminal }));
    }
  }
  if (!nodes.length) nodes.push(h('div', { class: 'empty-chat' }, 'No messages yet. Write to the Coordinator below.'));
  $('#chat-list').replaceChildren(...nodes);

  const pinned = $('#pinned');
  if (latest && !latest.replied) {
    const target = latest.terminal ? document.querySelector('.msg.you.latest') : document.getElementById(`a-${latest.id}`);
    pinned.replaceChildren(h('button', { type: 'button', class: 'pinned', onclick: () => target && flashTo(target) },
      h('div', { class: 'pinned-meta' }, h('span', { class: 'who' }, 'You'), latest.terminal ? h('span', { class: 'tag' }, 'terminal') : null, h('span', null, fmtTime(latest.t)), h('span', { class: 'waiting' }, 'Waiting for Coordinator')),
      h('div', { class: 'pinned-text' }, noEmDash(latest.text || 'Image'))));
  } else pinned.replaceChildren();

  const key = entries.map((e) => e.key).join('|');
  const grew = key !== lastChatKey;
  lastChatKey = key;
  if (firstChatRender || stickToBottom || nearBottom) {
    sc.scrollTop = sc.scrollHeight;
    $('#jump').hidden = true;
  } else {
    sc.scrollTop = prevTop;
    if (grew) $('#jump').hidden = false;
  }
  firstChatRender = false;
  stickToBottom = false;
}

function flashTo(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ---------- Sessions and lane activity (right) ----------
function sessionStatus(key) {
  const st = state.sessions[key];
  if (!st || !st.exists) return { cls: 's-missing', label: 'No status file', stale: false };
  const stale = st.mtime != null && Date.now() - st.mtime > STALE_MS;
  const openQs = state.needs.questions.filter((q) => q.status === 'open');
  const waiting = openQs.some((q) => q.aboutKey === key || (key === 'coordinator' && !q.aboutKey));
  // A board with a State field says it itself; older boards fall back to "Blocked on".
  const b = st.board;
  // Handing off or Stopped: the session is done and needs a restart.
  // Done for today: a quiet grey card, never stale, no restart.
  if (b?.state === 'done') return { cls: 's-done', label: 'Done for today', stale: false };
  if (b?.state === 'handoff') return { cls: 's-restart', label: 'Handing off', stale };
  if (b?.state === 'stopped') return { cls: 's-restart', label: 'Stopped', stale };
  if (b?.state === 'blocked') return { cls: 's-blocked', label: 'Blocked', stale };
  if (b?.state === 'decision') return { cls: 's-decision', label: 'Needs decision', stale };
  if (b?.state === 'other') return { cls: 's-other', label: noEmDash(b.stateText.split(/[.(;:]/)[0]).trim().slice(0, 28), stale };
  if (b?.state === 'working') return { cls: 's-working', label: b.etaShort ? `Working, ${b.etaShort} left` : 'Working', stale };
  const blocked = key !== 'coordinator' && !isNone(st.fields?.['Blocked on']);
  if (blocked) return { cls: 's-blocked', label: 'Blocked', stale };
  if (waiting) return { cls: 's-waiting', label: 'Waiting on you', stale };
  return { cls: 's-working', label: 'Working', stale };
}

// Does this board carry the new fields (State, Started, ETA, Decision, Done today)?
const hasBoard = (st) => !!(st?.board && (st.board.state || st.board.started || st.board.eta || st.board.doneToday.length));

function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const hr = Math.floor(m / 60);
  return m % 60 ? `${hr}h ${m % 60}m` : `${hr}h`;
}

function decisionInfo(d) {
  if (!d) return null;
  const q = d.id ? state.needs.questions.find((x) => x.id === d.id) : null;
  const what = q ? (q.title || String(q.text || '').split('\n')[0]) : d.id || d.text;
  return { what: noEmDash(what), id: d.id, blockedIn: d.blockedIn, settled: q ? q.status !== 'open' : false, found: !!q };
}

// One line under the "Now" line that the state calls for, or null.
function stateLine(key, ss) {
  const st = state.sessions[key];
  const b = st?.board;
  if (!b) return null;
  if (ss.cls === 's-decision') {
    const d = decisionInfo(b.decision);
    return h('div', { class: 'scard-decision' },
      h('span', { class: 'dq' }, d ? d.what : 'Waiting on a decision'),
      d?.blockedIn ? h('span', { class: 'din' }, `Blocked in ${d.blockedIn}`) : null);
  }
  if (ss.cls === 's-blocked' && !isNone(st.fields?.['Blocked on'])) return h('div', { class: 'scard-blocked' }, noEmDash(st.fields['Blocked on'].split('\n')[0]));
  if (ss.cls === 's-restart') return h('div', { class: 'scard-restart' }, 'Needs restart: click its VS Code profile');
  if (ss.cls === 's-working' && (b.started || b.eta)) {
    return h('div', { class: 'scard-meta' }, [
      b.started ? `${fmtDuration(Date.now() - b.started)} in` : null,
      b.eta ? 'ETA is rough' : null,
    ].filter(Boolean).join(' · '));
  }
  return null;
}

// The expanded part of a lane card: Now, Started, ETA, open PRs, then Done today.
function laneDetails(key) {
  const st = state.sessions[key];
  const f = st.fields || {};
  const b = st.board;
  const d = decisionInfo(b.decision);
  const open = prNums(f['Open PRs']);
  const kv = (label, value) => value ? h('div', { class: 'kv' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value)) : null;
  return h('div', { class: 'scard-more' },
    f.Now ? kv('Now', noEmDash(f.Now)) : null,
    b.started ? kv('Started', `${fmtTime(b.started)}${new Date(b.started).toDateString() === new Date().toDateString() ? '' : `, ${fmtDay(b.started)}`} (${fmtDuration(Date.now() - b.started)} ago)`) : null,
    b.eta ? kv('ETA', `${b.eta}${/rough/i.test(b.eta) ? '' : ' (rough)'}, as of ${fmtTime(st.mtime)}`) : null,
    d ? kv('Decision', [d.what, d.found && d.id ? `(${d.id})` : null, d.blockedIn ? `blocked in ${d.blockedIn}` : null, d.settled ? 'answered' : null].filter(Boolean).join(' · ')) : null,
    kv('Open PRs', open.length ? h('span', { class: 'pr-links' }, open.map((n) => {
      const p = state.prs?.[n];
      const tag = p && p.ok ? (p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : null) : null;
      return h('span', { class: tag ? 'gone' : '' }, prLink(n), tag ? ` ${tag}` : '');
    })) : 'none'),
    h('div', { class: 'done-today' },
      h('div', { class: 'k' }, `Done today${b.doneToday.length ? ` (${b.doneToday.length})` : ''}`),
      b.doneToday.length ? h('ul', null, b.doneToday.map((x) => h('li', null,
        h('span', { class: 'dt-task' }, noEmDash(x.task)),
        h('span', { class: 'dt-meta' }, [
          x.pr ? prLink(x.pr) : null,
          x.started || x.finished ? `${x.started || '?'} to ${x.finished || '?'}` : null,
          x.took ? h('b', null, x.took) : null,
        ].filter(Boolean).flatMap((part, i) => (i ? [' · ', part] : [part])))))) : h('div', { class: 'muted small' }, 'Nothing yet')),
    h('button', { type: 'button', class: 'more', onclick: () => openDrawer(key) }, 'Full status file and messages'));
}

function nowLine(key) {
  const st = state.sessions[key];
  if (!st || !st.exists) return `No ${state.sessions[key]?.file || 'status file'} yet`;
  if (key !== 'coordinator') return st.fields?.Now || 'No "Now" line';
  const m = st.raw.match(/^\s*Now\s*:\s*(.+)$/im);
  if (m) return m[1];
  const first = st.raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^updated\s*:/i.test(l));
  return first ? first.replace(/^[-*#>\s]+/, '') : '';
}

function openPrCount(key) {
  const st = state.sessions[key];
  if (key === 'coordinator' || !st?.exists) return null;
  return prNums(st.fields?.['Open PRs']).filter((n) => !isGone(n)).length;
}

function renderSessions() {
  const focused = document.activeElement?.closest?.('#session-cards [data-card]')?.dataset.card;
  $('#session-cards').replaceChildren(...SESSIONS.map((s) => {
    const ss = sessionStatus(s.key);
    const st = state.sessions[s.key];
    const n = openPrCount(s.key);
    const foot = [n == null ? null : n === 1 ? '1 open PR' : `${n} open PRs`, ss.stale ? `quiet ${fmtAgo(st.mtime)}` : null].filter(Boolean).join(' · ');
    // Boards with the new fields expand in place; older boards and the coordinator open the drawer.
    const expandable = s.key !== 'coordinator' && hasBoard(st);
    const id = `lane:${s.key}`;
    const open = expandable && expanded.has(id);
    const main = h('button', {
      type: 'button', class: 'scard-main', dataset: { card: s.key },
      onclick: () => { if (!expandable) return openDrawer(s.key); open ? expanded.delete(id) : expanded.add(id); renderSessions(); },
      'aria-expanded': expandable ? String(open) : null,
      'aria-label': `${s.name}: ${ss.label}. ${expandable ? (open ? 'Hide details' : 'Show details') : 'Open details'}`,
    },
      h('div', { class: 'scard-head' }, h('span', { class: `sdot ${ss.cls}`, 'aria-hidden': 'true' }), h('span', { class: 'name' }, s.name), state.models?.[s.name] ? h('span', { class: 'smodel', title: `Runs ${state.models[s.name].model}. Change it with /model in its terminal.` }, state.models[s.name].label) : null, ss.stale ? h('span', { class: 'stale-chip', title: `Board not updated for ${fmtAgo(st.mtime).replace(/ ago$/, '')}` }, 'stale') : null, h('span', { class: `state ${ss.cls}` }, ss.label)),
      h('div', { class: 'scard-now' }, noEmDash(nowLine(s.key))),
      stateLine(s.key, ss),
      foot ? h('div', { class: 'scard-foot' }, foot) : null);
    return h('div', { class: `scard ${ss.cls} ${ss.stale && !open && ss.cls !== 's-restart' ? 'stale' : ''} ${open ? 'open' : ''}` }, main, open ? laneDetails(s.key) : null);
  }));
  if (focused) document.querySelector(`#session-cards [data-card="${focused}"]`)?.focus();
}

// Every lane update, newest first. Only in the Activity log drawer (for debugging).
function activityList() {
  const items = state.updates.filter((u) => u.fromKey && u.fromKey !== 'coordinator' && u.kind !== 'done').slice(0, 150);
  return items.length ? h('div', { class: 'activity-list' }, items.map((u) => {
    const id = `act:${u.line}`;
    const open = expanded.has(id);
    return h('button', { type: 'button', class: `act ${open ? 'open' : ''}`, 'aria-expanded': String(open), onclick: () => { open ? expanded.delete(id) : expanded.add(id); renderDrawer(); } },
      h('div', { class: 'act-meta' }, dot(u.fromKey), h('span', null, [u.from, u.kind, u.pr ? `#${u.pr}` : null, u.to && !/^coordinator$/i.test(u.to) ? `to ${u.to}` : null].filter(Boolean).join(' · ')), h('span', { class: 'time', title: u.ts }, fmtTime(u.t))),
      u.text ? h('div', { class: 'act-text' }, noEmDash(u.text)) : null);
  })) : h('div', { class: 'nothing' }, 'No lane updates yet.');
}

// ---------- drawer ----------
function field(label, value, cls = '') {
  return h('div', { class: cls }, h('div', { class: 'field-label' }, label), h('div', { class: 'field-value' }, richText(value)));
}

function openDrawer(key) {
  drawerKey = key;
  renderDrawer();
  const d = $('#drawer');
  if (!d.open) d.showModal();
}

function renderDrawer() {
  if (!drawerKey) return;
  if (drawerKey === 'activity') {
    $('#drawer-title').replaceChildren('Activity log', h('span', { class: 'updated' }, 'every lane update, newest first'));
    $('#drawer-body').replaceChildren(activityList());
    return;
  }
  const s = sessionOf(drawerKey);
  const st = state.sessions[drawerKey];
  const ss = sessionStatus(drawerKey);
  $('#drawer-title').replaceChildren(h('span', { class: `sdot ${ss.cls}`, title: ss.label }), s.name, h('span', { class: 'updated' }, st.exists ? ago(st.mtime, 'Updated ') : ''));
  let status;
  let prs = [];
  if (!st.exists) status = h('div', { class: 'status' }, h('div', { class: 'missing' }, `No status file yet (${st.file}).`));
  else if (drawerKey === 'coordinator') {
    prs = prNums(st.raw);
    status = h('div', { class: 'status' }, h('div', { class: 'coord-text', html: st.html }));
  } else {
    const f = st.fields || {};
    prs = prNums(f['Open PRs']);
    const quiet = ['State', 'Started', 'ETA', 'Decision', 'Branch', 'Files claimed', 'Done today', 'Handoff'].filter((k) => f[k] && !(k !== 'Handoff' && isNone(f[k])));
    status = h('div', { class: 'status' },
      f.Now ? field('Now', f.Now, 'now') : null,
      isNone(f['Blocked on']) ? null : field('Blocked on', f['Blocked on'], 'blocked'),
      isNone(f['Needs from other lanes']) ? null : field('Needs from other lanes', f['Needs from other lanes'], 'needs-lanes'),
      field('Open PRs', f['Open PRs'] || 'none'),
      quiet.length || st.extra?.length ? h('div', { class: 'quiet-fields' }, quiet.map((k) => field(k, f[k])), st.extra?.length ? field('Other', st.extra.join('\n')) : null) : null);
  }
  const msgs = state.updates.filter((u) => u.kind !== 'merge-order' && (u.fromKey === drawerKey || u.toKey === drawerKey || (drawerKey !== 'coordinator' && u.aboutKey === drawerKey)));
  $('#drawer-body').replaceChildren(
    h('section', { class: 'dsection' }, h('h3', null, 'Status file'), status),
    prs.length ? h('section', { class: 'dsection' }, h('h3', null, drawerKey === 'coordinator' ? 'PRs it mentions' : 'PRs'), h('div', { class: 'prs' }, prs.map(prRow))) : null,
    h('section', { class: 'dsection' }, h('h3', null, `Messages (${msgs.length})`),
      msgs.length ? h('div', null, msgs.map((u) => h('div', { class: 'dmsg' },
        h('div', { class: 'msg-meta' }, h('span', { class: 'who' }, dot(u.fromKey), u.from), u.to ? h('span', null, `to ${u.to}`) : null, h('span', { class: `kind kind-${u.kind}` }, u.kind), u.pr ? prLink(u.pr) : null, h('span', { class: 'time', title: u.ts }, `${u.t != null ? fmtDay(u.t) + ', ' : ''}${fmtTime(u.t)}`)),
        u.kind === 'done' ? h('div', { class: 'msg-text muted' }, `Settled ${u.replyTo || ''}`) : h('div', { class: 'msg-text' }, richText(u.text)))))
        : h('div', { class: 'missing' }, 'No messages yet.')));
}

// ---------- chrome ----------
function renderChrome() {
  const slot = $('#project-slot');
  if (state.projects.length > 1) {
    slot.replaceChildren(h('select', { class: 'project-select', 'aria-label': 'Project', onchange: (e) => switchProject(Number(e.target.value)) },
      state.projects.map((p) => h('option', { value: String(p.index), selected: p.index === projectIndex ? true : null }, p.name))));
  } else slot.replaceChildren(h('span', { class: 'project-name' }, state.project.name));
  $('#banner').replaceChildren(...(state.folderOk ? [] : [h('div', { class: 'banner' }, `Lanes folder not found: ${state.project.lanesFolder}. Check config.json.`)]));
  const items = [['plan', 'Plan'], ['rules', 'rules.md'], ['coordinator-rules', 'coordinator-rules.md']].filter(([k]) => state.docs[k]);
  $('#menu').replaceChildren(...items.map(([k, label]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); openDoc(k, label); } }, label)),
    h('div', { class: 'muted small', style: 'padding:8px 10px 4px;border-top:1px solid var(--line);margin-top:4px;overflow-wrap:anywhere' }, state.project.lanesFolder));
}

let activeTab = null;
function applyTabs() {
  if (activeTab == null) activeTab = state && state.needs.questions.some((q) => q.status === 'open') ? 'left' : 'chat';
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === activeTab));
  $('#col-left').classList.toggle('active', activeTab === 'left');
  $('#col-chat').classList.toggle('active', activeTab === 'chat');
  $('#col-right').classList.toggle('active', activeTab === 'right');
}

function render() {
  if (!state) return;
  const active = document.activeElement;
  const c = [...composers.values()].find((x) => x.textarea === active);
  const sel = c ? [c.textarea.selectionStart, c.textarea.selectionEnd] : null;
  renderChrome();
  renderNeeds();
  applyTabs(); // before the chat renders, so a visible chat can scroll to the bottom
  renderReady();
  renderChat();
  renderSessions();
  if ($('#drawer').open) renderDrawer();
  if (c && document.contains(c.textarea)) {
    c.textarea.focus({ preventScroll: true });
    c.textarea.setSelectionRange(sel[0], sel[1]);
  }
  for (const x of composers.values()) x.autosize();
}

function openMenu() { $('#menu').hidden = false; $('#menu-btn').setAttribute('aria-expanded', 'true'); $('#menu button')?.focus(); }
function closeMenu() { $('#menu').hidden = true; $('#menu-btn').setAttribute('aria-expanded', 'false'); }

async function openDoc(name, label) {
  const dlg = $('#doc');
  $('#doc-title').textContent = label;
  $('#doc-body').textContent = 'Loading';
  dlg.showModal();
  try {
    const r = await fetch(`/api/doc?p=${projectIndex}&name=${encodeURIComponent(name)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $('#doc-body').innerHTML = d.html;
  } catch (e) {
    $('#doc-body').textContent = e.message || 'Could not load it.';
  }
}

// ---------- live connection ----------
let es = null;
function connect() {
  if (es) es.close();
  const live = $('#live');
  es = new EventSource(`/events?p=${projectIndex}`);
  es.addEventListener('open', () => { live.className = 'live on'; live.lastChild.textContent = 'Live'; });
  es.addEventListener('error', () => { live.className = 'live off'; live.lastChild.textContent = 'Reconnecting'; });
  es.addEventListener('state', (e) => {
    try { state = JSON.parse(e.data); } catch { return; }
    live.className = 'live on'; live.lastChild.textContent = 'Live';
    render();
  });
}

function switchProject(i) {
  projectIndex = i;
  needsSeen = null; needsCur = null; needsIdx = 0; // a new project's cards are not "new"
  store.set('project', i);
  const u = new URL(location.href);
  u.searchParams.set('p', String(i));
  history.replaceState(null, '', u);
  for (const c of composers.values()) c.stopMic();
  composers.clear();
  mountMain();
  state = null;
  firstChatRender = true;
  if ($('#drawer').open) $('#drawer').close();
  connect();
}

function mountMain() {
  const c = composer('main', { placeholder: 'Reply to the Coordinator' });
  $('#chat-input').replaceChildren(c.el);
  // The reply box floats over the end of the chat; keep the last message clear of it.
  const box = $('#chat-input');
  const fit = () => $('#col-chat').style.setProperty('--composer-h', `${box.offsetHeight}px`);
  new ResizeObserver(fit).observe(box);
  fit();
}

// ---------- boot ----------
mountMain();
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => {
    activeTab = b.dataset.tab;
    applyTabs();
    if (activeTab === 'chat') { const sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight; }
  });
}
$('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#menu').hidden ? openMenu() : closeMenu(); });
document.addEventListener('click', (e) => { if (!$('#menu').hidden && !e.target.closest('.menu-wrap')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#menu').hidden) { closeMenu(); $('#menu-btn').focus(); } });
$('#jump').addEventListener('click', () => { const sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight; $('#jump').hidden = true; });
$('#chat-scroll').addEventListener('scroll', () => {
  const sc = $('#chat-scroll');
  if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < NEAR_BOTTOM_PX) $('#jump').hidden = true;
});
$('#pr-refresh').addEventListener('click', async () => {
  $('#pr-refresh').disabled = true;
  $('#pr-age').textContent = 'Checking';
  try { await fetch(`/api/prs/refresh?p=${projectIndex}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* next state event shows it */ }
});
$('#drawer-close').addEventListener('click', () => $('#drawer').close());
$('#drawer').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#drawer').addEventListener('close', () => { drawerKey = null; });
$('#card-modal').addEventListener('close', () => { modalKey = null; modalLive = false; });
$('#card-modal-close').addEventListener('click', () => $('#card-modal').close());
$('#activity-btn').addEventListener('click', () => openDrawer('activity'));
$('#doc-close').addEventListener('click', () => $('#doc').close());
$('#doc').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

setInterval(() => {
  for (const el of document.querySelectorAll('[data-ago]')) {
    const t = Number(el.dataset.ago);
    if (t) el.textContent = (el.dataset.prefix || '') + fmtAgo(t);
  }
  if (state) { renderSessions(); renderPrAge(); }
}, 30_000);

connect();
