# Claude Lanes: Parallel Agents

`claude-lanes` runs a project with several Claude Code sessions at once: one **coordinator** you talk to, and as many **lanes** as the work splits into (Lane A, Lane B, ...), each working its own area in its own git worktree. Add a lane at any time; the page shows it as soon as its status file exists. They share a small folder of plain text files (the plan, the rules, one status file per session), so any session can be restarted without losing its place.

This repo ships the workflow (a setup guide, templates and start commands) and a **local dashboard**: one page that shows what needs you, what's ready to merge, your chat with the coordinator, and what every session is doing.

![The dashboard, light](screenshots/wide-light.png)

## Quick start: the workflow

1. Clone this repo: `git clone https://github.com/Max-Walka/claude-lanes.git`
2. Read [docs/SETUP.md](docs/SETUP.md). It explains the setup and holds the message you paste into Claude Code in your project. Claude then writes the lanes folder (`~/.claude/lanes/<project>/`) from [templates/](templates/) and installs the `/coordinator` and `/lane` commands.
3. Start the sessions: `/coordinator <project>`, then one `/lane <letter> <project>` per lane (`/lane a <project>`, `/lane b <project>`, ...).

## Quick start: the dashboard

```
npm install
npm run demo        # made-up data on http://127.0.0.1:4318, to look around
cp config.example.json config.json   # then add your project
npm start           # http://127.0.0.1:4317
```

Needs Node 20 or later. For live PR state (CI, review score, open threads, merged or not), the GitHub CLI `gh` on PATH and signed in; without it, PRs show "PR state unavailable" and everything else works. The server listens on 127.0.0.1 only.

### Config

`config.json` (or the file named in the `LANES_CONFIG` env var):

```json
{
  "port": 4317,
  "person": "Sam",
  "projects": [
    { "name": "acme", "lanesFolder": "~/.claude/lanes/acme", "repoFolder": "~/code/acme" }
  ]
}
```

- `person`: the name the sessions use for you in `to` and `from` (default `User`). Your lines show as "You".
- `lanesFolder`: the shared folder with `plan.md`, the status files and the two `.jsonl` files.
- `repoFolder`: the project's git checkout. `gh` runs there, read-only.
- `port`: optional, default 4317. The `PORT` env var wins over it.
- `stagingHealthUrl`: optional. A URL that answers JSON with a `release` commit id, such as a staging health check. Read (GET only, about once a minute) only while a to do waits for a staging release, so that card can move out of Waiting by itself. Without it, such a card stays in Waiting.
- `showModels`: optional, default `true`. Shows the model each session runs, on its card and (for the coordinator) by the send button. It is read, never changed, from the newest Claude Code transcript whose session name (`claude -n "Lane A"`) matches, in `~/.claude/projects` (or `transcriptsFolder`). Only the session name and the model id are read. To change a model, type `/model` in that session's terminal; the page cannot do it.
- More than one project adds a switcher to the top bar. Relative paths resolve from the config file's folder; `~` works.

## What the page shows

Everything fits on one screen; each column scrolls inside itself. Under about 1000px wide the columns become tabs.

- **Left: Needs you.** Rows, each with a small heading and count ("Urgent · 2") and its own carousel; a row with no cards is hidden. **Urgent**: cards tagged `urgent` or `blocking`, and lane restart cards (title starting "Lane X handed off" or "Restart Lane X"). **Decide**: the other open questions. **Do**: to dos you can do now. **Check on staging**: to dos whose title starts with Check, Compare or Try, or that have `"check":"staging"`. **Waiting**: to dos you cannot do yet, greyed, each saying what it waits for; one moves to Do or Check by itself when that clears. A card that fits two rows goes to the first of Urgent, Decide, Waiting, Check, Do. The header count leaves Waiting out. "Question" cards are the coordinator's questions, with option buttons and a reply box. "To do" cards are follow-ups for you, with numbered steps and a Done button. Every open to do has Done, wherever it shows: Needs you (also when Waiting) and the Ready to merge window. The card shows only its kind (Question or To do), lane, PR link, tags and its whole title; click it for a window with the text, steps and the option buttons or Done. Answering or pressing Done closes the window and shows the next card. Order within a row: cards tagged `urgent` first, then `blocking`, then the rest, newest first within each. When a new card arrives (or leaves Waiting) its row jumps to it and it glows briefly. Tags come from an optional `tags` array on any line (`"tags":["urgent"]` is red, `["blocking"]` orange); `after:"merge"` to dos also get "after merge". A to do can carry SQL to run: `"sql":[{"title":"...","query":"...","expect":"..."}]`. The window then shows one query at a time with its title ("2 of 3: ..."), the query highlighted with its spacing and line breaks kept exactly, a Copy button and "Expect: ...". Terminal commands work the same way: `"cmds":[{"title":"...","command":"...","expect":"..."}]`, shown as PowerShell, with Copy copying only the command. Plain strings work too (`"cmds":["npm test"]`, `"sql":["SELECT 1;"]`). A card can have both (SQL first). The arrow buttons or the Left and Right keys flip between queries or commands (the keys flip the block the pointer was last on). The window widens to fit the longest query line, up to the screen width; only past that does the query scroll sideways. Click outside the window or press Escape to close it. To dos have a reply box too, so you can answer from the card ("still waiting on them") without leaving it; the reply is an answer with `replyTo` the card id. Needs you never folds and is only as tall as its rows; Ready to merge sits right under it, folds to its header and opens downward.
- **Left: Ready to merge.** Folds to its header, "Ready to merge · 3"; click the header to open or fold it, remembered on this browser. Its window has a reply box (an answer with `replyTo` "pr-N" and `pr`). One row per PR, in exactly the coordinator's latest merge order with its numbers, showing the plain name from the merge order's `labels` (else the GitHub title), owning lane, and CI and review score when GitHub answered. The PR number links to GitHub. Click a row for a window with what it does (the coordinator's latest `ready` line for it), anything to do before merging (its to dos without `after`), what to check on staging (its `after:"merge"` to dos) and the GitHub link. Only PRs in the latest merge order are listed, and the header counts them, e.g. "Ready to merge (2)". A PR a lane calls ready is not listed until the coordinator puts it in the merge order. To dos about a PR on this list do not show in Needs you; its row shows "1 to do" and its window lists them. Ready to merge is for the project's own repo only: a line with a `repo` field (another repo) is ignored.
- **Centre: the chat.** You and the coordinator, laid out like a chat app: your messages (including what you type in its terminal, tagged "terminal") are bubbles on the right, its replies plain text on the left with a copy button. The reply box sits at the bottom: + adds an image, the mic dictates, and the coordinator's model shows beside the send button. Your latest message stays pinned at the top until the coordinator replies. Type, dictate with the mic, or paste or drop screenshots. The mic uses the browser's Web Speech API (Edge and Chrome), which sends the audio to the browser maker's online speech service; if dictation fails, the box says why (each step is also logged to the console as `[dictation]`). Windows voice typing (Win+H in the box) works as a fallback.
- **Right: Sessions.** One card per session: its state, its "Now" line and open PR count. A lane whose status file has a `State` line shows Working (with a rough "~N min left" and how long it has been on the task), Needs decision or Blocked (orange, with the question and when it will block, or the `Blocked on` line), Handing off or Stopped (red, "Needs restart: click its VS Code profile"), Done for today (grey, never stale), or any other `State` exactly as written (grey); click it to expand its task, start time, ETA, open PRs and what it finished today, with how long each took. Older status files without `State` show a dot (red blocked, blue waiting on you, green working). A card whose status file is over 60 minutes old (lanes rewrite it only when something changes) gets a grey "stale" chip and fades (a red restart card never fades). The full status file, PRs and messages open in a drawer. The status file format is in `templates/status-file.md`. Below them, a small **Activity log** link opens every lane update, newest first, in a drawer (for debugging).
- **Menu:** `plan.md`, `rules.md`, `coordinator-rules.md`, read-only.

Files are watched and changes reach the page live (server-sent events). PR state is cached and refreshed every 60 seconds, or with Refresh. The page never changes code and never messages a session itself: it reads the lanes folder (and, for the model names, the start and end of recent Claude Code transcripts), and writes only `answers.jsonl` plus new files in `attachments/` (and its own `logs/` folder next to `config.json`).

## Live session status (Claude Code hooks)

Status files change only when a session rewrites them, so a lane stuck on a permission prompt or an error can go unnoticed for a while. With the hooks below installed, every session reports as it happens, and each session card gets a live chip:

| Chip | When |
| --- | --- |
| **Working** (green) | A prompt was sent or a tool ran |
| **Waiting for you** (blue) | A permission prompt or a question waits in the terminal. After 2 minutes the chip turns red and the card gets a red outline |
| **Idle** (grey) | The turn finished |
| **Error** (red) | A tool failed, or the turn ended on an API error. The next event clears it |

Each chip says "since hh:mm"; hover it for the reason. A session that reports live is not faded for a quiet status file.

![Live chips on the session cards](screenshots/live-status.png)

**Which card.** A session's working folder decides it. A folder named `lane-<id>` (such as `<repo>/.claude/worktrees/lane-b`, or `~/code/acme-lane-b`) is that lane; the project is the one whose `repoFolder` holds it, or the only project. The `repoFolder` itself (or a folder inside it) is the coordinator. Any other folder shows under the cards as "Other sessions", by folder name. Status is kept in memory (sessions quiet for 12 hours are dropped), and every event is appended to `logs/sessions.jsonl` next to `config.json`.

**Install.** Add this to `~/.claude/settings.json` (user-wide, so every session reports), with the path to `scripts/lane-hook.mjs` in your clone. Merge it into an existing `"hooks"` block if you have one. New sessions pick it up; restart running ones.

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "StopFailure": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node \"C:/Dev/lanes-dashboard/scripts/lane-hook.mjs\"", "async": true, "timeout": 10 }] }]
  }
}
```

- `async: true` runs the hook in the background, so it never holds up a session. The script itself gives up after about 2 seconds, prints nothing and always exits 0, also when the dashboard is not running.
- It sends only the session id, working folder, event name, notification type and message, tool name and error text, never the prompt or tool output. It posts to `http://127.0.0.1:4317/api/session-event`; set `LANES_HOOK_URL` to use another port.
- `PostToolUse` runs after every tool call. It is there so a card goes back to Working once you approve a permission prompt; leave it out if you prefer, and the chip then stays on Waiting until the turn ends.

**Check it works.** With the dashboard running, send a prompt in any lane: its card shows Working within a second, then Idle when the turn ends. `logs/sessions.jsonl` gets one line per event. By hand, from a lane's folder:

```
echo '{"session_id":"test","cwd":"'"$PWD"'","hook_event_name":"Stop"}' | node C:/Dev/lanes-dashboard/scripts/lane-hook.mjs
```

## The two files

### `updates.jsonl` (sessions append, the page reads)

One JSON object per line. `ts` comes from the real clock, with an offset.

```json
{"ts":"2026-01-15T09:40:00+13:00","from":"Lane A","to":"Coordinator","kind":"ready","pr":212,"text":"PR #212 ready: payment step on the new API."}
{"ts":"2026-01-15T09:12:00+13:00","id":"q-0115-reindex","from":"Coordinator","to":"Sam","kind":"question","about":"Lane B","title":"Reindex staging search now, or wait for tonight?","text":"Lane B's tests need data in the staging index.","options":["Reindex now","Wait for tonight"]}
{"ts":"2026-01-15T09:50:00+13:00","id":"todo-0115-keys","from":"Coordinator","to":"Sam","kind":"todo","about":"Lane A","pr":212,"after":"merge","title":"Switch staging to the new payment keys","text":"Checkout fails on staging without them.","steps":["Open the staging environment variables","Set PAYMENTS_API_KEY","Redeploy staging"]}
{"ts":"2026-01-15T09:44:00+13:00","from":"Coordinator","to":"Sam","kind":"merge-order","prs":[212,209],"note":"#212 first","labels":{"212":"Pay by card on the new checkout","209":"Search uses the new index"}}
{"ts":"2026-01-15T08:41:00+13:00","id":"t-0115-0841","kind":"chat","from":"Sam","source":"terminal","to":"Coordinator","text":"What's closest to ready?"}
{"ts":"2026-01-15T08:42:00+13:00","from":"Coordinator","to":"Sam","kind":"chat","replyTo":"t-0115-0841","text":"#212, the payment step."}
{"ts":"2026-01-15T10:50:00+13:00","from":"Coordinator","to":"Sam","kind":"done","replyTo":"q-0115-reindex"}
```

| `kind` | Meaning | Shown |
| --- | --- | --- |
| `ready` | A PR is ready for you (`pr`). The coordinator's own `ready` line for a PR, in plain words, is its "What it does" | Ready to merge, Activity log |
| `blocked`, `info` | News | Chat if from the coordinator to you; the Activity log if from a lane |
| `chat` | A chat message; `from` you with `source:"terminal"` mirrors your terminal | Chat |
| `question` | A decision (`id`, `about`, `title`, `text`, `options`) | Needs you, as a Question card |
| `todo` | A follow-up (`id`, `about`, `pr`, `after:"merge"`, `title`, `text`, `steps`, optional `check:"staging"`, `waitsFor`, `sql`) | Needs you, as a To do card. It waits (row Waiting) while `after:"merge"` and `pr` is not merged, while `"waitsFor":{"pr":N}` is not merged, or while `"waitsFor":{"stagingRelease":"<sha>"}` is not what staging runs |
| `merge-order` | The merge order (`prs`, `note`, optional `labels`: PR number to a plain one-line name); the latest one wins | Orders and numbers the Ready to merge rows, and names them |
| `done` | Settles the question or to do whose `id` is `replyTo` | Greys it out, moves it to "Recently done" |

- `about` names the session a card concerns ("Lane A", or "Coordinator"); it turns that session's dot blue while a question is open.
- `steps` items may hold `"\n- "` sub-bullets. Chat text renders line breaks and `- ` bullets. `http` and `https` addresses become links.
- A coordinator line with `replyTo` set to one of your message ids is a reply to it and unpins it.
- Unknown fields are ignored. Lines that are not JSON objects are skipped.

### `answers.jsonl` (only the page appends)

```json
{"ts":"2026-01-15T10:36:00+13:00","id":"a-3f9c21d07b44","to":"Coordinator","text":"I'll try #212 after lunch."}
{"ts":"2026-01-15T10:41:00+13:00","id":"a-81c0e2a95d10","to":"Coordinator","replyTo":"q-0115-reindex","choice":0,"text":"Reindex now","attachments":["/home/sam/.claude/lanes/acme/attachments/a-81c0e2a95d10-1.png"]}
{"ts":"2026-01-15T11:02:00+13:00","id":"a-5b7e14c2f9a3","to":"Coordinator","replyTo":"todo-0115-keys","done":true,"text":"Done"}
```

- `to` is always `Coordinator`. The coordinator watches this file (see `templates/coordinator-rules.md`) and passes lines on.
- `replyTo`: the question or to do `id`. Left out for chat messages.
- `choice`: the option button's index, if the reply still starts with that option.
- `done: true`: the Done button on a to do.
- `attachments`: full paths of pasted or dropped images, saved as `<lanesFolder>/attachments/<id>-<n>.png` (other image types are converted to PNG). Up to 10 per message, 10 MB each.

## Repo layout

| Path | What |
| --- | --- |
| `docs/SETUP.md` | The workflow: how it works, how to set it up, your day, restarting, rules |
| `docs/DESIGN.md` | The dashboard's design spec |
| `templates/` | `plan.md`, `rules.md`, `coordinator-rules.md`, `status-file.md`, and the `/coordinator` and `/lane` commands |
| `server.js`, `lib/` | The Node server (no framework; one dependency, `marked`) |
| `public/` | The page: plain HTML, CSS and JS |
| `examples/` | The demo lanes folder and fake PR states used by `npm run demo` |
| `scripts/lane-hook.mjs` | The Claude Code hook that reports live session status (see "Live session status") |

## Development

- `npm test`: unit tests for the parsers and the live status, plus the `/api/session-event` endpoint and the hook script against a real server on a random port.
- `npm run demo`: the page on made-up data (port 4318), in a temp copy, so nothing real is touched.
- `npm run screenshots -- [url] [outDir]`: light and dark, wide and narrow screenshots with the installed Edge or Chrome (via `playwright-core`, a dev dependency that downloads no browser). Defaults to the demo.

![The dashboard, dark and narrow](screenshots/narrow-dark.png)

## License

MIT. See [LICENSE](LICENSE).
