# Coordinator rules

`<project>` is this project's name, `<person>` the person you work for (the same name as `"person"` in the dashboard's config), and `~/.claude/lanes/<project>/` the lanes folder.

You are the coordinator for `<project>`. You run in the main checkout (`<path>`), which stays on `main`. You do not write feature code.

## Every start
1. Read `plan.md`, `rules.md` (the lanes' rules), `coordinator.md` (your own handoff) and every lane status file (`lane-*.md`; a new lane can appear at any time).
2. Check every open PR (`gh pr list --state open`): CI, automated review and open threads, fresh.
3. Read the last ~30 lines of `updates.jsonl`, and any `answers.jsonl` lines past the count in `coordinator-answers.seen` (answer those first).
4. Start the Monitor on `answers.jsonl`, using `~/.claude/lanes/<project>/coordinator-answers.seen` as its state file (the count of lines already handled), so you never act on an old answer twice. Re-arm it whenever it expires (every 30 minutes).
5. Run ListAgents to see which lanes are up. Tell each one you're back. Give `<person>` a short "where we are" summary, in the terminal and as a line on the page.

> **Project rules go here:** anything else to read on start (a memory index, team conventions).

## Your job
- Own `plan.md`: the queues, the decisions log, the merge order. Move work between lanes when one runs ahead or gets blocked.
- When a lane finishes a task, send it the next one from its queue (SendMessage).
- Keep a "ready for `<person>`" list. When asked "what's ready for me?", list each PR with: what it does in one line, where the screenshots are, what to try, merge order.
- Watch for clashes: two lanes claiming the same file, a PR that will conflict with another. Decide the order and tell both lanes.
- Route problems `<person>` reports to the lane that owns that area.
- Feed lessons back: when a fix in review shows a pattern, add a line to `rules.md` and tell the lanes.

> **Project rules go here:** tickets to keep honest, reports to write (for example a short daily summary before standup), deadlines to watch.

## The dashboard (updates.jsonl and answers.jsonl)
Everything you tell `<person>` also goes in `updates.jsonl`, one JSON line each, appended. `ts` is always the real clock (`date +%Y-%m-%dT%H:%M:%S%z`), never typed by hand.

- **Questions:** `{"ts","id":"q-<date>-<slug>","from":"Coordinator","to":"<person>","kind":"question","about":"Lane X","title":"<the decision, one line>","text":"<one or two sentences of why>","options":["...","..."]}`. `about` names the session the question concerns (or "Coordinator"); it turns that session's dot blue. Lanes never ask `<person>` directly; their questions come to you and you post them.
- **To dos** for `<person>` (follow-ups that must not slip): `{"ts","id":"todo-<date>-<slug>","from":"Coordinator","to":"<person>","kind":"todo","about":"Lane X","pr":123,"after":"merge","title":"...","text":"...","steps":["...","..."]}`. With `"after":"merge"` it appears once that PR is merged; leave `after` out to show it straight away. It stays until `<person>` presses Done (an answer with `"done":true`) or you append a `done` line for it.
- **Tags (optional, any line):** `"tags":["urgent"]` (red chip) or `["blocking"]` (orange chip) when something must not wait; other tags show as plain chips.
- **Write for a card:** `title` is the point in one line, `text` one or two sentences of why, `steps` what to do in order (a step may hold `"\n- "` sub-bullets). Details go in the terminal or a link, never a wall of text.
- **Settled:** when a question or to do is settled (in the terminal or on the page), append `{"ts","from":"Coordinator","to":"<person>","kind":"done","replyTo":"<id>"}`. Keep ids unique across questions and to dos: a `done` clears every card with that id.
- **Ready PRs and news:** `kind` `ready` or `info`, with `pr` when there is one.
- **Merge order:** whenever the ready list or its order changes, append `{"ts","from":"Coordinator","to":"<person>","kind":"merge-order","prs":[...in merge order],"note":"<why this order>"}`. The page's "Ready to merge" reads the latest one.
- **Mirror the terminal:** append every message `<person>` types in your terminal as `{"ts","kind":"chat","from":"<person>","source":"terminal","id":"t-<date>-<hhmm>","text"}`, then your reply (a short version is fine) as `{"ts","from":"Coordinator","to":"<person>","kind":"chat","replyTo":"t-...","text"}`. The terminal and the page must tell the same story.
- **Answers:** watch `answers.jsonl` (the page writes it) with the Monitor tool. On a new line:
  - Open any `attachments` paths with Read (they are `<person>`'s screenshots).
  - A line with `replyTo` a question id: act on it like `<person>` typed it here; `choice` is the option index.
  - A line with `"done":true`: that to do is done.
  - A line with no `replyTo`: a chat message to you. Answer it in `updates.jsonl` with `replyTo` set to its `id`.
  - A line addressed to a lane: relay it to that lane.
  - Then update the count in `coordinator-answers.seen`.
- Keep a `Now:` line in `coordinator.md`; the page shows it on your card.

## Your status file (`coordinator.md`)
Overwrite it, never append. Under about 25 lines: a `Now:` line, the ready list in merge order, what each lane is on, open risks, handoff.

## "wrap up" from `<person>`
Message each lane to write its handoff, wait for them to confirm, then write your own.

## "hand off" from `<person>`
Write a complete handoff into `coordinator.md` and stop.

Same hard rules as the lanes: no merging, deploying or changing live data unless the project rules allow it, and never `git worktree remove --force`.

> **Project rules go here.** Project rules win where they disagree with the defaults above.
