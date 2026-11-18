# Status files

One short file per session in the lanes folder: `coordinator.md` and one `lane-<letter>.md` per lane (`lane-a.md`, `lane-b.md`, ...; add one for each new lane). Each session overwrites its own file, never appends, and keeps it under about 20 lines. The dashboard shows it on the session's card and in its drawer.

## Lane status file (`lane-a.md`, `lane-b.md`, ...)

Exactly these keys, one per line. `Done today` and `Handoff` may run over several lines (indent the extra lines).

```
Updated: <date and time>
State: <Working | Needs decision | Blocked | Handing off | Stopped | Done for today>
Now: <current task, one line>
Started: <ISO time the current task started>
ETA: <rough time left, e.g. ~40 min; base it on Done today lines for similar work>
Decision: <none | the question id, and "blocked in ~N h" = when you run out of other work without it>
Branch: <current branch>
Open PRs: #123 (state), #124 (state)
Files claimed: <shared files you are editing that another lane might touch>
Blocked on: <none | what, and who>
Needs from other lanes: <none | what>
Done today:
  - <task> | <#PR or none> | started HH:MM | finished HH:MM | took Nh Nm   (one line each, newest first)
Handoff: <the half-finished step, and anything the next session must know>
```

The dashboard reads these keys:

- `State` sets the card's look: Working (green dot), Needs decision and Blocked (orange card), Handing off and Stopped (red card, "Needs restart: click its VS Code profile"). Done for today: a grey card, never marked stale. Any other value shows as written, in grey. A board not updated for 15 minutes shows "stale". Working = has a task. Needs decision = working, but a later task waits on an answer. Blocked = nothing left to do without the answer. Stopped = handed off, needs a restart.
- `ETA` shows on a Working card as "Working, ~40 min left" (the first estimate in the line; labelled rough), with the time since `Started`.
- `Decision` shows on a Needs decision card: the question's title (looked up by id) and "Blocked in ~N h".
- Click a card with these fields to expand it: Now, Started, ETA, open PRs, then Done today with how long each took.
- `Now` is the line on the session's card.
- Boards without `State` fall back: `Blocked on` other than `none` turns the card's dot red ("Blocked"), and an open question about the lane turns it blue ("Waiting on you").
- `Open PRs` gives the card's open PR count; `#123` numbers become live PR rows in the drawer.
- The file's last-modified time is the card's age. A card fades when the file is over an hour old.

## Coordinator status file (`coordinator.md`)

Looser, rendered as markdown. Keep a `Now:` line near the top: the dashboard shows it on the coordinator's card.

```
Updated: <date and time>
Now: <one line: what you're watching and what's waiting on the person>
Ready for <person> (merge in this order):
- #123 (Lane A) <what it does>. <checks>. Try: <what to try>.
Waiting on <person>: <open questions, one line each>
Lane A: <what it's on>
Lane B: <what it's on>
Lane C: <what it's on>
Risks: <anything that could slip>
Handoff: <the half-finished step>
```
