# Status files

One short file per session in the lanes folder: `coordinator.md`, `lane-a.md`, `lane-b.md`, `lane-c.md`. Each session overwrites its own file, never appends, and keeps it under about 20 lines. The dashboard shows it on the session's card and in its drawer.

## Lane status file (`lane-a.md`, `lane-b.md`, `lane-c.md`)

Exactly these keys, one per line. `Handoff` may run over several lines (indent the extra lines).

```
Updated: <date and time>
Now: <current task, one line>
Branch: <current branch>
Open PRs: #123 (state), #124 (state)
Files claimed: <shared files you are editing that another lane might touch>
Blocked on: <none | what, and who>
Needs from other lanes: <none | what>
Handoff: <the half-finished step, and anything the next session must know>
```

The dashboard reads these keys:

- `Now` is the line on the session's card.
- `Blocked on` other than `none` turns the card's dot red ("Blocked").
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
