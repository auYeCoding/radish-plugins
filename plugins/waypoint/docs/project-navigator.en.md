# project-navigator

English | [简体中文](project-navigator.md)

[Back to WayPoint](../README.en.md)

Guides a large project starting from a single high-level requirement: it confirms the requirements, lays out a roadmap that advances by milestones and vertical slices, builds a walking skeleton that runs from the real entry point first, then fills it out one slice at a time, and records progress in the repository so that any session can pick up the work.

The skill targets three common problems:

- **Starting work without a roadmap.** The skill first confirms the requirements with you, then lays out the roadmap; only the current milestone is planned in detail, and later ones are planned when you reach them.
- **Growing horizontally, and finding at the end that features and the interface were never connected.** Every slice is vertical and must be visible from the entry point or the interface when it is done; the review must give the call path from the entry point to the new code, and a slice that is not wired in cannot be followed by the next one. Ideas outside the current slice go into the backlog and are not done on the side.
- **Forgetting the progress when the session changes.** Progress is recorded by scripts in `.navigator/`, and what to do next is computed by scripts, not left to the model's memory.

The session that invokes this skill is called the orchestrator session. It only plans, records, and organizes reviews. Code is written by executor subagents it dispatches in the background, and reviews are done by a reviewer subagent in a fresh context.

## When to use it

- Starting from scratch on a project that will take weeks or longer.
- Moving an existing project forward, when you want every change to have a clear goal, completion criteria, and a review.
- Projects such as reverse engineering or live measurement, where you investigate as you build: the investigation can be planned as slices that only produce findings.

It does not fit these cases: fixing a typo, fixing a small bug, writing a one-off script. Just ask Claude directly for small tasks like these.

## Requirements

- [Git](https://git-scm.com): the project must be a Git repository. If it is not a repository yet, run [`/waypoint:repo-init`](repo-init.en.md) first.
- [Node.js](https://nodejs.org) 22 or later: the hooks and commands run on Node.js.
- Start Claude Code in the project root.

## Invocation

The skill can only be invoked explicitly. Natural language never triggers it:

```text
/waypoint:project-navigator [init | check | uninstall | initial requirement]
```

- No argument: show the current progress and continue as prompted.
- `init`: initialize the project.
- `check`: check that the records agree with the state.
- `uninstall`: stop using the skill, keeping all records.
- Any other text: used as the initial requirement, for example `/waypoint:project-navigator build a tool that collects the team's weekly reports`.

Any session that invokes the skill continues from the recorded state; there is nothing to take over or register.

## Quick start

Take "build a tool that collects the team's weekly reports" as an example, starting from a new repository that has only a README. In every reply from the orchestrator session, the first line is the conclusion and the second line is the progress; when you need to decide something, the reply ends with options that start with a letter, and you answer with the letter.

### First invocation

1. Start Claude Code in the project root and enter `/waypoint:project-navigator build a tool that collects the team's weekly reports`.
2. The skill asks whether to initialize in this project. Once you agree, it creates `.navigator/`, writes the allow rules, and invokes [`commit-message`](commit-message.en.md) to commit these files.

### Intake

1. The skill restates its understanding of the requirement, points out what is vague, missing, or conflicting, and asks you the open questions one by one. It does not make assumptions on its own.
2. Once confirmed, the requirements are written to `.navigator/requirements.md`, the single source of truth for the requirements.
3. The skill asks you to confirm two project settings: how modules are organized, and how finished work is verified. See [Project settings](#project-settings) below.
4. The skill lays out the roadmap: the first slice of the first milestone is the walking skeleton, and each later slice adds one capability on top of the skeleton. After you approve it, the roadmap is committed and intake is complete.

### One slice

1. The skill reads the relevant code first, then writes the plan for this slice: goal, completion criteria, explicit exclusions, module layout. When the plan contains something you need to decide, it asks you first; when it does not, work starts right away, and you do not need to look the plan over first.
2. The skill dispatches an executor subagent in the background. You can go do something else, or keep talking to the orchestrator session.
3. When the executor subagent needs you to answer a question or do something by hand, the skill passes the question or the steps on to you unchanged; after you reply, the same subagent continues.
4. When the work is done, the skill dispatches a reviewer subagent to check it, and reports to you the verdict on each criterion, the results of the wiring check and the structure check, and the steps you need to verify by hand.
5. You decide: pass and commit, rework, or abandon this slice.

Normally a slice needs only one decision from you, after the review.

### Every time you come back

Open a new session in the project root and enter `/waypoint:project-navigator` with no argument. The skill gives the current position and the next step, and continues.

## Core concepts

### Milestones and slices

- **Milestone:** a stage result that means something to you.
- **Slice:** a piece of vertical functionality that one round of implementation plus one review can finish. A slice contains the interface, logic, and data it needs together; work is not cut horizontally by layer.
- **Walking skeleton:** the first slice. It enters from the real entry point (an executable, an exported function, a page), passes through every planned layer, and does the minimum in each layer, to prove that the layers connect. No other slice is worked on before the skeleton passes review; the skeleton cannot be abandoned.
- Only one slice is worked on at a time.

There are two kinds of slices:

| Kind                   | Written as | What it does                                                                                       | Who does it                                                                      |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Changes code           | `build`    | Implements a piece of functionality                                                                | The executor subagent in the background                                          |
| Only produces findings | `findings` | Reverse engineering, live measurement, research: gets one thing clear and writes down the findings | By default, the orchestrator session, directly in the conversation (interactive) |

### Interactive slices

In tasks such as reverse engineering and live measurement, every step may need you to do something in the program being debugged. A subagent cannot talk to you, so for this kind of slice no subagent is dispatched; the session you are talking to does the work directly:

- It only produces findings, written under `.navigator/findings/`, and does not change business code.
- Each finding is written to a file as soon as it is confirmed, together with the host version, the location, the verification method, and the verification time.
- When debug output fills up the context, open a new session and invoke the skill to continue: the findings are in files and the progress is in the state.
- When it is done, a reviewer subagent checks it independently as usual.

Research that does not need your cooperation (purely reading code or documentation) can be marked as non-interactive in the roadmap and handed to the executor subagent in the background.

### Project settings

Two settings are registered during intake, and the plan and review of every later slice follow them:

**Module organization.** Modular design follows the same principles everywhere, but how it is expressed depends on the project:

| Value         | How modules are expressed                                                                                                       | Fits                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `directories` | One physical directory per module                                                                                               | Python, Web, Go, and similar projects |
| `filters`     | Source files lie flat in the project directory, and Visual Studio virtual filters (`.vcxproj.filters`) divide them into modules | Visual Studio projects                |

The skill gives a suggestion based on whether the repository has project files such as `.sln` or `.vcxproj`, and you confirm it.

**Verification mode.**

| Value      | Meaning                                                                  | During review                                                                                                     |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `auto`     | There are check commands that can be run directly in the repository root | The reviewer subagent runs these commands                                                                         |
| `manual`   | You have to build or run it yourself to confirm                          | The subagent does not build or run; it lists the verification steps for you, and you accept after confirming them |
| `measured` | It has to be measured in the real environment                            | Same as above                                                                                                     |

### Modularity constraints

When the project settings are registered, the skill writes the engineering standards to `.claude/rules/engineering.md`, which every session and subagent in the project loads automatically. The points related to modularity:

- Constants, types, configuration, and rules are defined only once (SSOT).
- Layers are divided by responsibility, and cross-layer access goes only through interfaces.
- Reuse existing implementations first; until there are two real duplicates, do not create a generic module and do not push code down into a shared layer (YAGNI).
- The granularity of modules and files is set by clear responsibilities, not by splitting for its own sake.

These are not just rule text. Every slice that changes code has two fixed checks:

- "模块安排" (module layout) in the plan: which module each new or changed file belongs to, which layer it is in, and which one thing it is responsible for; where the single definition of each new constant and type lives; what is reused.
- "结构核对" (structure check) in the review: the reviewer subagent answers item by item: whether new files are in the modules the plan names; whether there is only one definition; whether cross-layer access goes only through interfaces; whether an implementation that could have been reused was rewritten; whether a generic module with only one user was created; whether several existing modules were forced to change their internal implementation.

Projects that divide modules with filters have one more check, done by a script: every source file is assigned to a filter in `.vcxproj.filters`, and no source file added by this slice was put in a physical subdirectory. The result is written directly into the review prompt, and the check can also be run at any time:

```bash
project-navigator check --filters
```

## The round trip of a slice

1. **Write the plan.** After reading the code, the orchestrator session creates the slice file under `.navigator/slices/` and fills in the Plan part. The goal, completion criteria, explicit exclusions, and module layout are hard constraints; the remaining details are working assumptions.
2. **Start work.** When the plan contains nothing you need to decide, work starts right away. The script records the commit at that moment and the digest of the Plan part.
3. **Implement.** The executor subagent works to the plan, tests its own work, and writes the Result part. In it, "接线证据" (wiring evidence) gives the call path from the program entry point to the new code.
4. **Handback.** The executor subagent cannot ask you questions. When it needs an answer or an action from you, it writes what it has established so far into "中途记录" (interim notes) and ends the current run; the orchestrator session passes the question on to you unchanged, and after you reply the subagent continues. The slice status does not change during this, and work does not need to be started again.
5. **Corrections and pending criteria.** When a detail in the plan does not match reality, the executor subagent gathers evidence, works to what is actually there, and records each case in the "修正" (corrections) table, without stopping to ask you. When an individual completion criterion cannot be met as a matter of fact, it finishes the rest and lists the criterion under "待定标准" (pending criteria). You see both in one go at review time.
6. **Submit for review.** The script checks that the Plan part was not changed during implementation and that the Result part is filled in.
7. **Review.** The reviewer subagent checks item by item in a fresh context. There are only three verdicts: pass, fail, and unverified, and each comes with evidence. It traces the wiring from the entry point itself and does not copy the path the executor wrote.
8. **Your decision.**

| Situation                  | You can choose                                                 |
| -------------------------- | -------------------------------------------------------------- |
| All pass                   | Pass and commit; pass, commit, and push                        |
| Some unverified, none fail | Accept as is and commit; rework                                |
| Some fail                  | Rework; abandon this slice (the skeleton can only be reworked) |

For rework, the orchestrator session writes what needs to be redone into the plan, this round's review is archived in the same file, the executor subagent continues, and the slice is then reviewed again.

After a pass, the orchestrator session invokes commit-message and puts this slice's code changes and records into one commit.

## Milestone review, requirement changes, and wrap-up

- **Milestone review:** when all slices of a milestone have ended, the skill explains how far the milestone goal was met, goes through the backlog with you, and lays out the slices of the next milestone.
- **Requirement changes:** you can raise them at any time. The skill explains the impact, and after you confirm it updates the requirements file and the roadmap and records a decision: what was decided, why, and what was given up. Slices that have already started are not changed; ideas mentioned only in passing go into the backlog.
- **Wrap-up:** when all milestones are complete, the skill explains the results item by item against the requirements, and wraps up after you confirm. After wrap-up you can still add milestones and continue.

## Record files

```text
.navigator/
├── state.json          Progress and numbering; modified only by plugin commands
├── roadmap.md          Roadmap view, generated from the state
├── requirements.md     Requirements: goal, must-haves, explicit exclusions, constraints, confirmed conclusions
├── decisions.md        Decision log, append-only
├── backlog.md          Backlog: ideas outside the current slice
├── slices/
│   └── 0003-export-csv.md    One file per slice: Plan, Result, Review
└── findings/           Findings and evidence scripts written by slices that only produce findings
```

- `.navigator/drafts/` holds the drafts the orchestrator session uses to pass content to commands, and is not committed. Everything else is committed.
- The `.gitignore` that ships inside `.navigator/` re-includes the record files; at initialization and on every invocation of the skill, the records are checked against all of Git's ignore rules, and when a record would be ignored the skill stops and names the rule.
- The records are all in Git. After you roll back or edit the records by hand, the skill continues from the records as they are.

## Roles and boundaries

| Role                 | Who                                                          | What it does                                                                                       | What it can write                                       |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Orchestrator session | The session that invokes this skill                          | Confirms requirements, lays out the roadmap, writes plans, organizes reviews, records progress     | Only `.navigator/`                                      |
| Executor subagent    | Dispatched in the background by the orchestrator session     | Writes code to one slice's plan, tests its own work, writes the Result                             | Business files, the slice file in progress, `findings/` |
| Reviewer subagent    | Dispatched by the orchestrator session, with a fresh context | Checks the completion criteria, wiring, structure, and scope item by item, and hands back evidence | Writes no files                                         |
| You                  | The only one who makes the calls                             | Requirements, trade-offs, review verdicts                                                          |                                                         |

The hook guards only four write boundaries: nobody edits the state file or the roadmap view directly; the reviewer subagent writes no files; under `.navigator/`, the executor subagent writes only the slice file in progress and the findings directory; the orchestrator session writes no files outside `.navigator/`. Everything else relies on the skill's rules and is not intercepted. The hook is provided by the plugin and is not written into the project configuration; in a project that has not been initialized it does nothing.

The orchestrator session does not write business code so that its context stays reserved for planning and progress: when you say "just fix this while you're at it", it puts the request into the current slice's plan or the backlog.

### Permission prompts

When the executor subagent writes files in the background, in the default permission mode the write confirmations pop up in the orchestrator session. A slice often writes many files, so during implementation you can switch the session to "Accept edits" (file edits are accepted automatically). Whether to switch is up to you.

## Upgrading from 1.x

2.0.0 is an incompatible redesign: the unit of work changed from the work order to the slice, and the records have a completely different structure. It does not read 1.x records and does not migrate them.

When you invoke the skill in a project initialized under 1.x after updating the plugin, the skill explains this. After you agree, it runs:

```bash
project-navigator init --archive
```

The old `.navigator/` is renamed as a whole to `.navigator-1.x/`, with its contents untouched and still available to consult; then everything starts again from intake. During intake you can have the skill read the brief and the decisions in the archive, so you do not have to dictate everything from scratch.

If you do not agree, the skill ends without changing anything. To keep using the 1.x workflow, pin the plugin at 1.5.0.

## FAQ

**Why did typing "help me plan a project" not trigger this skill?**

The skill can only be invoked explicitly with `/waypoint:project-navigator`, so that an ordinary conversation does not start a whole workflow by mistake.

**Can the orchestrator session write a piece of code for me?**

No. Writes by the orchestrator session to files outside `.navigator/` are rejected. When code needs to change, put it into a slice and let the executor subagent do it.

**Can I keep talking to the orchestrator session while the executor subagent is working?**

Yes. The subagent runs in the background; when it finishes, the orchestrator session is notified and carries on.

**I closed the orchestrator session. What happens to the executor subagent's work?**

A subagent belongs to the session that started it, and its work is interrupted when the session closes. A new session that invokes the skill dispatches a new one, and the new subagent continues from the "中途记录" (interim notes) in the slice file and the changes already in the working tree.

**My project cannot be compiled or run by Claude. Can I use the skill?**

Yes. During intake, register the verification mode as `manual` or `measured`. The subagents do not build or run; they only read the code to check wiring and structure. Criteria that can only be confirmed by running are listed as steps and handed to you, and after confirming them you choose to accept as is.

**I thought of a new idea, but it does not belong to the current slice?**

Just say it. The skill records it in `.navigator/backlog.md`, and at the milestone review decides with you where to schedule it.

**Can several slices run in parallel?**

No. Only one slice is worked on at a time, which keeps every slice's base commit and review result well defined.

**How do I stop using it?**

Run `/waypoint:project-navigator uninstall`. The allow rules are removed, the plugin's hook no longer takes effect in this project, all records in `.navigator/` are kept, and you can initialize again later.

## Known limitations

- Every machine that uses the project needs Node.js 22 or later.
- The plugin's hook fires in every project, and every write-tool call and every message starts Node.js once; in a project that has not been initialized the script ends immediately.
- The guard only checks the target paths of write tools, not the command line: when the orchestrator session changes code or installs dependencies from the command line, only the skill's rules constrain it.
- The reply format (conclusion first, one line of progress) relies only on the skill's rules and is not validated.
- A slice file is written part by part by the orchestrator session and the executor. The script uses the digest of the Plan part to discover that it was changed during implementation; it can detect this but cannot prevent it.
- No script checks whether the orchestrator session really read the code before writing the plan; errors in the plan are caught by the executor subagent's "修正" (corrections) and by the review.
- Apart from the filters check, the items of "结构核对" (structure check) are judged by the reviewer subagent and are not deterministic.
- The filters check parses project files with regular expressions and covers only the common forms; items with wildcards or MSBuild macros are not checked, only counted.
- An interactive slice uses up the orchestrator session's context; "write each finding to a file immediately" and "you can switch sessions at any time" mitigate this.
- The executor subagent cannot ask you questions while it works; it can only end the current run and have the orchestrator session relay them.
