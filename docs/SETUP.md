# Claude Lanes: Parallel Agents

Several Claude Code sessions work on one project together: one coordinator you talk to, and as many lanes as the work splits into. Three is a good start; add more later. To set it up on any project, clone this repo, open Claude Code in your project, paste the message under "Set it up" with your details filled in, and Claude builds the rest.

## How it works

**The coordinator** is the one session you talk to. It does not write code. It keeps the plan, gives each lane its next task, spots two lanes about to change the same file, and tells you what is ready for you to check.

**The lanes** (Lane A, Lane B and so on) each work on their own area, in their own copy of the code, so they never get in each other's way. Everything a session needs to remember lives in a shared folder of short text files, so any session can be closed and started again without losing its place.

```
                          you
                           |
              terminal or dashboard (127.0.0.1:4317)
                           |
                    +-------------+
                    | Coordinator |  main checkout, never writes feature code
                    +-------------+
                     /     |     \        SendMessage when it can't wait
              +--------+ +--------+ +--------+
              | Lane A | | Lane B | | Lane C | ...  each in its own git worktree
              +--------+ +--------+ +--------+
                     \     |     /
          ~/.claude/lanes/<project>/   (the shared folder, outside git)
          plan.md   rules.md   coordinator-rules.md
          coordinator.md  lane-a.md  lane-b.md  ...   (status files, one per session)
          updates.jsonl  (sessions append)   answers.jsonl  (the page appends)
```

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Coordinator | The Claude Code session you talk to | Your main project folder |
| Lanes A, B, ... | Claude Code sessions that do the work, as many as you need | Each in its own copy of the code (a git worktree) |
| `plan.md` | What each lane works on, in order, plus decisions and merge order | The shared folder: `~/.claude/lanes/<project>/` |
| `rules.md` | How every lane works: the default rules plus your project's own | The shared folder |
| `coordinator-rules.md` | The coordinator's job | The shared folder |
| Status files | One short file per session: what it is doing, its open work, anything blocking it | The shared folder (`coordinator.md`, then `lane-a.md`, `lane-b.md` and so on) |
| Start commands | `/coordinator <project>` and `/lane <letter> <project>` | `~/.claude/commands/`, so they work in any project |

Sessions also message each other directly when something can't wait, such as "I'm about to change the menu file". Each session's name is its address, so names must be different across projects running at the same time.

## The dashboard

A web page on your own computer shows every session on one screen, and you can reply to the coordinator from it instead of the terminal. Open http://127.0.0.1:4317 in Edge or Chrome. Everything fits without scrolling.

| Column | What it shows |
| --- | --- |
| Left: Needs you | Decisions waiting for you, with answer buttons, and to dos with a Done button, each noting which session it's about. Below that, **Ready to merge**: pull requests numbered in the order to merge them, with their test results and review score. |
| Centre: chat | You and the coordinator. Type, dictate with the mic, or paste a screenshot. Anything you type in the coordinator's terminal shows up here as well. |
| Right: sessions | One card per session: green for working, blue for waiting on you, red for blocked, plus one line on what it's doing. Below them, a feed of lane updates. |

**How it works.** Every session writes a one-line note to `updates.jsonl` in the shared folder whenever it reports something, and the page reads that file as it changes. What you send from the page goes into `answers.jsonl`, and the coordinator watches that file and acts on it or passes it to a lane. Pasted screenshots are saved in an `attachments` folder beside them. The page checks pull request status through GitHub's command-line tool. It never changes code and never messages a session itself.

**Setting it up.**

1. You need Node 20 or later, and the GitHub command-line tool (`gh`) signed in.
2. Clone this repo anywhere you like, and in that folder run `npm install`.
3. Copy `config.example.json` to `config.json` and add your project: its name, its shared folder (`lanesFolder`) and its code folder (`repoFolder`). Set `person` to the name the sessions use for you. With more than one project, a switcher appears at the top of the page.
4. Run `npm start` and leave that terminal open. (To look around first, `npm run demo` shows made-up data on port 4318.)
5. Tell the coordinator the page is running, so it starts watching for your replies.

## Set it up

You do this once per project. It takes about ten minutes, most of it Claude working.

1. Clone this repo if you haven't (see the README).
2. Open Claude Code in your project's folder.
3. Copy the message below, fill in the blanks, and send it.
4. Answer any questions Claude asks. It only asks about what you left out.
5. When Claude says it's done, open one terminal per session and start each one ("Starting and restarting" below).

```
Set up parallel agents for this project. Follow the "For Claude" section of
<path to your clone>/docs/SETUP.md, using the files in <path to your clone>/templates/.

Project name (short, one word): ___
What we're doing and by when: ___
My name, as the sessions should address me: ___
Use the dashboard? (yes/no): ___

Lane A works on: ___
Lane B works on: ___
Lane C works on: ___
(One line per lane, as many lanes as you like. List each lane's tasks in order, most important first.)

Project rules (anything the agents must or must not do): ___
Files more than one lane might change: ___
Who checks and approves the work: ___
Where tickets live, if anywhere: ___
```

Not sure how to split the work? Write the whole list once and ask Claude to suggest a split. Give each lane areas that don't touch the same files, so they rarely clash.

## Your day

1. **Start:** open the sessions and the dashboard. Ask the coordinator "where are we?"
2. **Check in a couple of times a day:** check the dashboard's Needs you and Ready to merge columns. For each pull request, look at the screenshots, try it, and approve or send it back.
3. **In between:** leave them to it. Answer the questions the coordinator passes on.
4. **Close:** tell the coordinator "wrap up". Every session writes a note on where it got to, so tomorrow starts cleanly.

## Starting and restarting

Use one terminal per session (VS Code or Windows Terminal), not the Claude chat panel. If Claude made terminal profiles for you, pick **\<Project> Coordinator**, **\<Project> Lane A** and so on from the arrow next to `+` in the terminal panel. Nothing to type.

Without profiles, start Claude Code in a terminal and type:

| Session | Type this |
| --- | --- |
| Coordinator | `/coordinator <project>` |
| Lane A | `/lane a <project>` |
| Lane B | `/lane b <project>` |
| Lane C | `/lane c <project>` |
| Any later lane | `/lane d <project>`, `/lane e <project>`, ... |

**Adding a lane later:** add its section to `plan.md` and an empty `lane-<letter>.md` to the shared folder, then start it with `/lane <letter> <project>` (and a terminal profile if you use them). The dashboard shows it as soon as the file exists.

Starting and restarting are the same thing. The session reads its rules, the plan and its status file, checks its open work and carries on.

**When a session gets slow, forgetful or full, restart only that one.** The others keep working.

1. In that session, type `hand off`.
2. Wait for it to say its note is written.
3. Type `/exit`, or close the terminal.
4. Start it again the same way.

Nothing is lost: the plan, the status notes, the code, the pull requests and the tickets all live outside the conversation. Start a fresh session rather than resuming the old one. Resuming brings back the full old conversation, which is what you were trying to clear.

## Who to talk to

| You want to | Talk to |
| --- | --- |
| Know where things stand, or what's ready for you | Coordinator |
| Change priorities, or move work between lanes | Coordinator |
| Report a problem you found | Coordinator (it passes it to the right lane) |
| Give feedback on one specific piece of work | That lane directly |
| Watch or steer work in progress | That lane directly |

If in doubt, ask the coordinator.

## Rules every lane follows

These are the defaults in `templates/rules.md`. Your project rules are added on top, and win where they disagree. You don't have to police them, but knowing them helps you spot one being broken.

1. **Read the plan and the other lanes' status files before each task.** Keep your own status file current. Rewrite it, don't add to the bottom.
2. **Claim a shared file before changing it.** Note it in your status file, tell the other lanes, keep the change small.
3. **Small pieces of work, a few at a time.** At most 4 waiting for review per lane. At that limit, stop starting new work and finish what's open.
4. **Nothing reaches you until it's ready:** tests pass, any automatic review is clean, a second agent has checked it fresh, and there are screenshots for anything you can see.
5. **The second check gets the change, what it was meant to do, and the old code it replaces.** Not the lane's own notes, so it judges the work with fresh eyes.
6. **Never merge, release or touch live data.** The person in charge does that, unless your project rules say otherwise.
7. **Stuck for more than 30 minutes?** Write it in the status file and tell the coordinator.
8. **Getting full?** Write a handoff note and ask for a restart.

When a review keeps finding the same kind of mistake, the coordinator adds a rule for it and tells the lanes.

## When something goes wrong

| Problem | Do this |
| --- | --- |
| A session crashed or you closed it | Start it again. It picks up from its status file. |
| A session is confused or going in circles | Tell it "hand off", then restart it. |
| Two lanes changed the same file | Tell the coordinator. It decides which goes in first; the other catches up. |
| Something broke after you approved a change | Tell the coordinator. The lane that made it fixes it before anything else. |
| Too much is waiting for you | Tell the coordinator "pause new work". Lanes finish what's open. |
| A lane is heading the wrong way | Stop it, correct it, and have it update its status file. |

## For Claude: how to build this

You are setting up the system this page describes, for the project in the person's message. Follow these steps in order. Write every file in plain language, and keep each one short. The repo's `templates/` folder holds a starting point for every file; fill in its `<placeholders>` and replace each "Project rules go here" block with the person's rules (or delete it).

1. **Check what you were given.** You need a project name, a goal, the person's name, a task list for each lane, and the project rules. Ask in one message for anything missing. If the person asks you to split the work, suggest a split where the lanes touch different files, and wait for a yes.
2. **Read the project first.** Read its `CLAUDE.md`, `AGENTS.md` and README if they exist, and note how changes get tested, reviewed and released. Those steps go into the rules.
3. **Check for an existing setup.** Look in `~/.claude/lanes/` and `~/.claude/commands/`. If the project name is taken, ask for another. Never overwrite another project's files.
4. **Make the shared folder** `~/.claude/lanes/<project>/`. It sits outside the code on purpose, so it never ends up in git. Put these files in it:
   - `plan.md` (from `templates/plan.md`): the goal and deadline; one section per lane with its tasks in order (top item = now); the shared files list; the merge order; an empty decisions log.
   - `rules.md` (from `templates/rules.md`): "Every start" and "First start" steps, the status file format, the rules from "Rules every lane follows" above, the project's own testing and review steps, and the person's project rules, which win where they disagree.
   - `coordinator-rules.md` (from `templates/coordinator-rules.md`): "Every start", the job, and the dashboard section. The coordinator never writes feature code and stays in the main project folder on the main branch.
   - `coordinator.md` and one `lane-<letter>.md` per lane (`lane-a.md`, `lane-b.md`, ...): starting status files (format in `templates/status-file.md`).
5. **Make the start commands** by copying `templates/commands/coordinator.md` and `templates/commands/lane.md` into `~/.claude/commands/`, if they aren't there already. If files with those names exist and point at one project's folder, rewrite them to take the project name, and keep that project as the answer when no name is given, so a setup already running keeps working.
6. **Offer terminal profiles** (VS Code, in the user's settings under `terminal.integrated.profiles.windows`, or `.osx` / `.linux`). One per session, each starting Claude in the project folder with a name and a starting message, for example: `claude -n "<Project> Lane A" -w <project>-lane-a "/lane a <project>"`. `-n` names the session, and `-w` gives the lane its own copy of the code. The coordinator gets no `-w`. Names must be unique across every project running at once, because a name is how sessions message each other.
7. **Finish by telling the person** what you made, in a few lines, and exactly how to start each session. Don't start any lane work yourself.

Hard rules for every session, whatever the project: no merging, releasing or changing live data unless the person's rules allow it, and never force-delete a copy of the code (`git worktree remove --force`).

**The dashboard.** If the person uses the dashboard, also:

- Add the project to the dashboard's `config.json` (copy `config.example.json` if there is none), and set `person` to the person's name.
- Keep the dashboard parts of the templates: lanes append their messages to `updates.jsonl`; the coordinator posts questions, to dos, merge orders and `done` lines there, mirrors every terminal exchange, and watches `answers.jsonl` with the Monitor tool, keeping the count of handled lines in `coordinator-answers.seen` so a restarted coordinator never acts on an old answer twice. The file formats are in the README.
