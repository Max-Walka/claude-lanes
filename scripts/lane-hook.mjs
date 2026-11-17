#!/usr/bin/env node
// Claude Code hook: tells the lanes dashboard what a session is doing.
// Claude Code runs it for Stop, Notification, UserPromptSubmit, PostToolUse,
// PostToolUseFailure, StopFailure, SessionStart and SessionEnd, with the hook's
// JSON on stdin. It posts a few fields (never the prompt text or tool output)
// to the dashboard and always exits 0, quickly and silently, even when the
// dashboard is not running. No dependencies.
//
// LANES_HOOK_URL overrides the address (default http://127.0.0.1:4317/api/session-event).
const URL_ = process.env.LANES_HOOK_URL || 'http://127.0.0.1:4317/api/session-event';
const READ_MS = 1000; // give up on stdin after this
const POST_MS = 800; // and on the dashboard after this
const KEEP = ['session_id', 'cwd', 'hook_event_name', 'notification_type', 'message', 'error', 'is_interrupt', 'reason', 'source', 'tool_name', 'agent_id'];

const quit = () => process.exit(0);
const hardStop = setTimeout(quit, READ_MS + POST_MS + 200);
hardStop.unref();
process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    setTimeout(done, READ_MS).unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; if (data.length > 1_000_000) done(); });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

async function main() {
  let input;
  try { input = JSON.parse(await readStdin()); } catch { return; }
  if (!input || typeof input !== 'object') return;
  const body = { ts: new Date().toISOString() };
  for (const k of KEEP) {
    const v = input[k];
    if (v == null) continue;
    body[k] = typeof v === 'string' ? v.slice(0, 1000) : v;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), POST_MS);
  try {
    await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch { /* dashboard down: say nothing */ }
  clearTimeout(t);
}

main().then(quit, quit);
