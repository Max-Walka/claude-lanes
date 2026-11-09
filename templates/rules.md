# Lane rules (every lane follows these)

`<project>` is this project's name, `<person>` the person you work for (the same name as `"person"` in the dashboard's config), and `~/.claude/lanes/<project>/` the lanes folder.

## First start in a new worktree (once)
1. Copy the project's local settings files (such as `.env`) from the main checkout into your worktree root.
2. Install dependencies fresh in the worktree (for example `npm ci`). Never link `node_modules` or similar from another folder.

> **Project rules go here:** anything else a fresh worktree needs (which env files, local services, ports to avoid so lanes don't clash).

## Every start
1. Read, in order: `plan.md`, this file, your status file, the other lanes' status files and `coordinator.md`.
2. Read the repo's `CLAUDE.md` and `AGENTS.md`, if they exist.
3. Check your open PRs (`gh pr list --author @me --state open`) against your status file, then carry on from your handoff note.
4. Update your status file and tell the coordinator you are up (SendMessage to "Coordinator").

> **Project rules go here:** anything else to read on start (a memory index, team conventions).

## Status file (`lane-<x>.md`)
Overwrite it, never append. Keep it under about 20 lines, in this shape:
```
Updated: <date and time>
Now: <current task, one line>
Branch: <current branch>
Open PRs: #123 (state), #124 (state)
Files claimed: <paths you are editing that another lane might touch>
Blocked on: <none | what, and who>
Needs from other lanes: <none | what>
Handoff: <the half-finished step, anything learned that the next session needs>
```
Update it when your task, PRs, claims or blockers change. Read the others before starting each task.

## Git and PRs
- Each PR: its own branch off `origin/main`, created inside your worktree.
- Batches of 3 to 5 small, independent PRs. No stacking unless a PR truly depends on another; say so in its body.
- At most 4 open PRs per lane. At the limit, stop new work and finish what is open.
- Rebase on `origin/main` before opening a PR.
- Never merge, deploy, run SQL against a real database, or force-push `main`. `<person>` does those, unless the project rules below say otherwise.
- Never `git worktree remove --force`.

> **Project rules go here:** branch naming, the PR body template, commit message rules, anything about editing PR bodies (for example, keeping a review bot's section intact).

## Ready for `<person>` (all of these before a PR goes on the ready list)
1. CI green.
2. Any automated review clean, every thread fixed or answered. Re-check fresh, never from memory.
3. A second review: spawn a fresh subagent with the diff, the spec and the old code being replaced (not your own notes), and fix what it finds.
4. Tests passing; screenshots on the PR for anything you can see.

> **Project rules go here:** the project's own checks (a review bot's score threshold, a checklist file, a ticket status).

Then message the coordinator: "PR #N ready for `<person>`: <one line>".

## Tickets

> **Project rules go here:** where tickets live, who they're assigned to, which statuses to use and when. Delete this section if the project has no tickets.

## Shared files and other lanes
- Before editing a shared file listed in `plan.md`: put it under "Files claimed", message the other lanes, keep the change small.
- If another lane has claimed a file you need, message that lane and wait, or work on something else.
- Messages are for things that cannot wait for the status file. Keep them to one or two lines.

## Updates log (for the dashboard)
Every message you send the coordinator also goes in `~/.claude/lanes/<project>/updates.jsonl` as one JSON line, appended (never rewrite the file):
`{"ts":"<ISO time with offset, from the real clock>","from":"Lane X","to":"Coordinator","kind":"ready|blocked|info","pr":<number, optional>,"text":"<the message>"}`
Use `ready` for "PR #N ready", `blocked` for blockers, `info` for the rest. One line each; keep the text the same as the message. Take `ts` from the clock (`date +%Y-%m-%dT%H:%M:%S%z`), never type it by hand.

Lanes never ask `<person>` directly. Questions go to the coordinator, who posts them.

## When stuck or full
- Stuck more than 30 minutes: write it under "Blocked on" and message the coordinator.
- Context getting heavy, or `<person>` says "hand off": write a complete handoff into your status file, tell the coordinator, and stop.

> **Project rules go here:** anything else every lane must or must not do. Project rules win where they disagree with the defaults above.
