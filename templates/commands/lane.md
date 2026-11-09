---
description: Start or restart this session as a lane (a, b or c) of a lanes project
argument-hint: <a|b|c> <project>
---
You are Lane $1 of project $2 (in messages and in `updates.jsonl`, write your name as "Lane A", "Lane B" or "Lane C").

Your status file is `~/.claude/lanes/$2/lane-$1.md` and your queue is your lane's section of `~/.claude/lanes/$2/plan.md`. Read `~/.claude/lanes/$2/rules.md` and follow its "Every start" steps now (and "First start in a new worktree" if your handoff says so), then carry on with your current task.

If the lane letter or the project name is missing, ask for it before doing anything else.
