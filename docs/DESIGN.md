# Dashboard design spec

The spec the dashboard is built to. Change it here first, then the code.

## What it is
A local web page for watching and answering four Claude Code sessions that work one project together: a Coordinator and three lanes (Lane A, B, C). It replaces following four terminals. It is generic: any project that uses the setup in `docs/SETUP.md` can point it at its lanes folder.

## What it reads (never changes)
A lanes folder per project, usually `~/.claude/lanes/<project>/`:
- `plan.md`: queues per lane, shared files, merge order, decisions log.
- `coordinator.md`, `lane-a.md`, `lane-b.md`, `lane-c.md`: one status file per session, rewritten each time. Lane files are `Key: value` lines (`Updated`, `State`, `Now`, `Started`, `ETA`, `Decision`, `Branch`, `Open PRs`, `Files claimed`, `Blocked on`, `Needs from other lanes`, `Done today`, `Handoff`; `Done today` and `Handoff` can run over several lines; see `templates/status-file.md`). The coordinator's file is looser markdown with a `Now:` line.
- `rules.md`, `coordinator-rules.md`: shown read-only, behind the menu.
- `updates.jsonl`: sessions append one JSON object per line (formats in the README).

## What it writes
Only `answers.jsonl` (appended) and new files in `attachments/` in the lanes folder. Nothing in any repo. It never runs `claude` and never messages a session; the coordinator watches `answers.jsonl` and passes lines on.

## Layout
One screen, no page scrolling: the page is the viewport height and each panel scrolls inside itself. At a glance it must be obvious what needs the person. Three columns; under about 1000px they become tabs (Needs you with a count, Chat, Sessions).

**Left (about 300px)**
- **Needs you**, one list: "Decide" cards (open `question` lines) first, then "To do" cards (open `todo` lines). Compact and scannable: tag, about chip, time; the `title` in bold (or the text's first sentence); the `text` as one or two sentences of why; `steps` as a numbered list with indented sub-bullets; then option buttons and a reply box, or a Done button. "Nothing needs you." when empty; when not, the header shows a count. One card shows at a time (fixed height, no list scrolling), with Previous / Next and "N of M" in the header; the shown card is tracked by id, so when it is answered or Done the card that takes its place, the next one, shows. Answered and settled cards fold into "Recently done".
  - A question is answered once an answer with its `replyTo` exists, and settled once a `done` line with its `replyTo` exists.
  - A to do with `"after":"merge"` appears once its PR is merged; until then it is a small "After #N merges" line under that PR's Ready row. It stays until Done is pressed (`{"replyTo":"<id>","done":true}`) or a `done` line arrives.
- **Ready to merge**: one row per unmerged PR, in exactly the latest `merge-order` line's order and keeping its numbers, with the PR number (linking to GitHub), its plain name from the merge order's `labels` (else the short GitHub title), owning lane (the lane whose `ready` line it was, never the Coordinator), CI and review score. Only merge-order PRs are rows here. Lane-reported `ready` PRs missing from the order sit below a divider under "Being checked by the Coordinator (N)": one muted, dashed, unnumbered line each (number, name, lane, "not in the merge order", CI), not expandable, so they never look mergeable. "Nothing to merge" when the order is empty (or "...yet" when no merge order exists). N in the header counts only merge-order rows. The header reads "Ready to merge · N of M open", M being `gh pr list --author @me --state open`. The merge-order `note` is not shown. Opening a row shows only plain words: what it does (the Coordinator's latest `ready` line for the PR), "Before you merge" (its open to dos without `after`), "Check on staging after merging" (its `after:"merge"` to dos, with steps) and the GitHub link. An "After #N merges" line under a row expands to the full to do; it hides while the row is open, which shows the same to do.

**Centre: the chat** with the Coordinator only: the person's messages (from the page, and `from:<person>` lines mirrored from the terminal, tagged "terminal") and the Coordinator's lines to the person. Sorted by `ts`, newest at the bottom, auto-scrolling unless the person has scrolled up. `question`, `todo`, `done` and `merge-order` lines are never chat rows, and Done presses are not shown. The person's latest message is highlighted and pinned at the top until a Coordinator line has `replyTo` = its id, or the Coordinator writes to the person after it. Input pinned at the bottom of the column.

**Right (about 300px)**: four compact session cards (dot, name, `Now` line, open PR count; click for a drawer with the full status file, its PRs with live state, and its messages). A lane board with a `State` field sets the look: Working (green, "Working, ~N min left" from `ETA`, plus time since `Started`), Needs decision (amber card with the question and "Blocked in ~N h"), Blocked (red card, only when `State` says so), Stopped (grey dashed, "Needs a restart"); clicking it expands Now, Started, ETA, open PRs and Done today with durations, with a link to the drawer. Boards without `State` fall back: "Blocked" (red) when `Blocked on` isn't none; "Waiting on you" (blue) only when an open question has `about` = that session; otherwise "Working" (green); clicking opens the drawer. A card fades when its file is over an hour old. Below the cards, a small **Activity log** link opens a drawer with every lane update, newest first, two lines each, click to expand. Hidden by default: the chat, cards and session cards cover it day to day.

**Menu** (top right): `plan.md`, `rules.md`, `coordinator-rules.md`, read-only. **Project switcher** in the top bar when more than one project is configured.

## Replying
- Every reply box takes typing, has a mic button that dictates live into the box (Web Speech API; hidden where unsupported), and takes pasted (Ctrl+V) or dropped images with thumbnails and a remove button before sending.
- Enter sends, Shift+Enter adds a new line.
- Option buttons fill the reply; the person can add words, then send. The line gets `choice`.
- Everything goes to the Coordinator.
- Images are saved as `<lanesFolder>/attachments/<answer id>-<n>.png` (other formats converted to PNG in the browser), never overwriting, and listed by full path in `attachments`.

## PR state
From the `gh` CLI, run read-only in the project's repo folder: `gh pr view N --json ...`, `gh pr checks N`, a GraphQL query for unresolved review threads, and `gh pr list --author @me --state open`. Shown: CI (pass, pending, fail), the review score (`Confidence Score: N/5` in the PR body), open threads, merged or open. Cached, refreshed every 60 seconds and on Refresh. If `gh` fails: "PR state unavailable" and nothing else.

## Look and feel
Clean and calm. Lots of space, one accent colour, a small fixed type scale (12, 14, 16, 20). Light and dark, following the system. Each session has one colour, used only as a small marker. No em dashes in any text the page shows (they are replaced in text read from files). Updates appear live without a reload (file watching plus server-sent events).

## How it runs
- `npm install`, then `npm start`; it prints a localhost URL. Listens on 127.0.0.1 only and refuses other Host and Origin headers.
- Config in `config.json` (see the README); `npm run demo` runs on made-up data.
- A Node server with one dependency (`marked`) and a plain HTML, CSS and JS front end.
- Windows first (paths, PowerShell, `gh` on PATH), with nothing Windows-only in the code.
