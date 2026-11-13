# Maintaining project-navigator

English | [简体中文](project-navigator-maintaining.md)

[Back to the usage guide](project-navigator.en.md)

This document is for maintainers: design overview, design decisions, component map, troubleshooting, change process, tests, and measured findings. Repository-wide maintenance conventions are in [MAINTAINING.en.md](../../../MAINTAINING.en.md).

## Design overview

The skill is responsible for only five things. Before adding any feature, confirm that it belongs to one of them:

1. Intake and roadmap: from a one-sentence requirement to a requirements file and a roadmap arranged by milestones and slices.
2. Progress: the state is recorded by scripts, the next action is computed by scripts, and any session can pick up the work.
3. Slice loop: the orchestrator session writes the plan, a subagent implements it, and another subagent reviews it independently.
4. Modularity constraints: single source of truth, layering by responsibility, modularity, no generic modules extracted ahead of time; how modules are expressed changes with the shape of the project.
5. Skeleton and wiring: the first slice is the walking skeleton, and every slice must give wiring evidence.

The skill consists of three layers:

| Layer           | Location                                       | Job                                                                                               |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Rules           | `SKILL.md`, `references/`, `guide/executor.md` | Written for the model: workflow, steps, how to write plans and results                            |
| Runtime scripts | `runtime/navigator.mjs`, `runtime/hook.mjs`    | Commands modify the state and compute the next action; the hook guards write boundaries           |
| Spec            | `spec/slice.json`, `standards/engineering.md`  | The single source for the sections of a slice file and for the default engineering standards pack |

Plugin-level wiring:

| Location                    | Contents                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `hooks/hooks.json`          | Three events (PreToolUse matching write tools only, UserPromptSubmit, SessionStart) all call `runtime/hook.mjs` |
| `bin/project-navigator`     | Command entry in the Bash tool, `exec node .../navigator.mjs "$@"`                                              |
| `bin/project-navigator.cmd` | Command entry in the PowerShell tool                                                                            |
| `agents/navigator-*.md`     | Executor and reviewer subagents                                                                                 |

In a user's project, the skill uses these locations:

| Location                       | Contents                                                                     | Committed |
| ------------------------------ | ---------------------------------------------------------------------------- | --------- |
| `.navigator/`                  | State file, roadmap view, requirements, decisions, backlog, slices, findings | Yes       |
| `.navigator/drafts/`           | JSON drafts the orchestrator session passes to commands                      | No        |
| `.claude/settings.json`        | Allow rules                                                                  | Yes       |
| `.claude/settings.local.json`  | Local copy of the allow rules, excluded by `.git/info/exclude`               | No        |
| `.claude/rules/engineering.md` | Project standards, written by `setup`, loaded automatically by every session | Yes       |

2.0.0 stores nothing under `.git/`.

## Design decisions

Each entry states the decision, the reason, and what happens if it is changed.

### Trade-offs in 2.0.0

Almost all of the 1.x iterations went into process control (the work order state machine, reply validation, review binding, pre-issue checks), while the quality of intake, how slices are cut, and how wiring is checked were never refined after the first version. 2.0.0 reverses that ratio.

- **Kept:** orchestration separate from implementation; independent review; engineering standards written into the project; state and next action managed by scripts; records committed, with the ignore rules checked; commits go through commit-message; the hook lives at plugin level; runtime scripts use only Node.js built-in modules; details that do not match reality are corrected to match it; individual criteria that cannot be met are listed as pending.
- **Removed:** the three files (work order, receipt, review report) and the work order state machine; about 20 reply types and the validation at the end of a reply; the digest binding and base-commit check for work order review; the pre-issue checker subagent; the problem-domain researcher subagent and the brainstorm archive; the glossary, the risk list, the change list; checkup numbering and the semantic checkup; the standards comparison workflow; the `evidence` command for technology selection and the source cache; subagent model configuration; the skill's self-check for anomalies and problem reports; writing-rule validation; buttons; stage numbers 0 to 6; the document generation step.
- **1.x records are not migrated.** The two kinds of records have different units (work orders and slices), a migration could only be approximate, and very few projects use 1.x. `init --archive` renames the old directory as a whole and deletes nothing. If changed: code that reads the old structure has to be maintained for the long term.

### Sessions and execution

- **The orchestrator session does not write business code; implementation uses background subagents.** The purpose is not to guard against malice but to guard against role collapse: one "just fix this while you're at it" from the user and the model writes the code itself, and from then on the context for planning and progress is taken over by implementation details. If changed: the orchestrator session gradually turns into an implementation session, and a long project loses its thread midway.
- **Interactive slices are done directly by the orchestrator session.** Tasks such as reverse engineering and live measurement need the user's cooperation at every step, and a subagent cannot talk to the user; 1.x added "waiting for action" for this, and an analysis work order still took several round trips. An interactive slice only produces findings, written to `.navigator/findings/`, which is already within the orchestrator session's write scope, so the guard needs no new rule and "does not write business code" is unaffected. Only `findings` slices can be interactive: writing code does not require talking to the user. If changed: back to one handback round per step.
- **No "open a separate execution session" mechanism.** 0.x did exactly this, and the machinery of identity registration, fork claiming, and orchestrator addresses was the source of most failures at the time. Now any session that has invoked the skill is an orchestrator session and the state is in files, so "continue in another session" needs no mechanism at all. If changed: back to registration and claiming.
- **The orchestrator session does not register; it is recognized by the orchestrator marker in the transcript.** The output of `enter` carries "编排标记: project-navigator 编排标记 <编号>" (orchestrator marker: project-navigator orchestrator marker <id>), where the id is the first 12 characters of the SHA-256 of the project path (lowercased first on Windows); the output is injected into the skill content, the skill content is recorded in the session transcript, and the hook reads `transcript_path` to find this marker. The source code contains only the prefix, so a session that reads the source code is not mistaken for one; `status` does not output the marker. A forked session copies the transcript and so naturally carries the marker. If changed: identity may be misjudged every time the session id changes.
- **The executor subagent cannot ask questions, so there is only one kind of handback.** It ends the current run, and the first line of its last message says "交回: 需要回答" (handback: needs an answer) or "交回: 需要操作" (handback: needs an action); the orchestrator session tells the user, then uses SendMessage to let the same subagent continue (measured: SendMessage can resume an ended subagent with its context). The slice status stays "实现中" (implementing) throughout. 1.x had three channels (blocked, waiting for action, pending criteria), each with its own reply type and state transitions. If changed: every extra channel adds a set of states and decisions.
- **Delegation prompts are generated by scripts, and the orchestrator session uses them unchanged.** `brief exec` and `brief review` are the only source of the prompts, and the section names in them come from the spec. If changed: the prompts scatter across rule files and gradually stop matching the structure of the slice file.
- **Subagents do not declare `tools` (executor) or only disable write tools (reviewer), the reviewer always runs on Sonnet, and the executor follows the session.** MCP tools installed by the user may be needed, so `tools` is not listed. Review is item-by-item comparison and evidence gathering and does not need the strongest model; the model is fixed in the `model` field of `agents/navigator-reviewer.md`. The model configuration command from 1.4.0 was removed: it was one more piece of state and one more place to go wrong; to change the model, edit that one line. The 2.0.0 rewrite of the subagent definitions left this line out, so the reviewer followed the session's model; 2.0.1 restores it. If changed: listing `tools` misses the user's tools; removing `model` makes review cost the same as the main model.

### Slices and review

- **The unit of work is the slice, one file per slice, in three parts.** The Plan is written by the orchestrator session, the Result by the executor, and the Review by the orchestrator session from what the reviewer subagent hands back. 1.x had three files, each with a fixed structure, and the workflow stopped when one could not be parsed. If changed: back to the three-file set.
- **Ownership of the parts is ensured by the digest of the Plan part.** The guard can only judge by path and cannot govern parts inside a file. `slice start` records the digest of the Plan part and `slice review` compares it, refusing to submit for review on a mismatch; when the orchestrator session changed it according to the user's answer, run `slice replan`. Before hashing, leading and trailing whitespace on each line is removed, whitespace is collapsed, and table separator rows are normalized: the digest does not change when a formatting hook realigns tables. This can only detect, not prevent; if it turns out to happen often in practice, the fallback is to split the Plan and the Result into two files.
- **The scripts read only what they need.** The completion criteria (a numbered list), whether "需要决定" (needs decision) and "补做" (rework) are "无" (none), "执行状态" (execution status), and the "标准核对" (criteria check) table (the verdict can only be one of the four in the spec, and every row needs evidence). For the rest they only check "not empty, no placeholder". Structure is not validated on write. If changed: the more structure rules, the more often work gets blocked.
- **By default the user is asked to decide only once, after the review.** When "需要决定" in the plan is not "无", `slice start` refuses, and after the user answers it is run with `--decided`. 1.x had a fixed two per work order (review of the order and review of the work), and in most order reviews the user simply clicked agree. The pre-issue check was removed too: the orchestrator session can read code anyway, and reads it itself before writing the plan. If changed: every slice gets one more confirmation that carries no information.
- **Hard constraints and working assumptions are two layers.** The hard constraints are the goal, the completion criteria, the explicit exclusions, and the module layout; the rest are working assumptions, and when they do not match reality the executor gathers evidence, works to what is actually there, and records it in the "修正" (corrections) table, which the review checks. 1.4.0 and earlier treated the plan as a contract, and a mismatched detail meant one round trip. If changed: exploratory tasks take one more round for every detail discovered.
- **The skeleton is a hard rule.** The first slice of the first milestone is marked as the skeleton by the script, and its kind must be `build`; `slice plan` refuses other slices until the skeleton passes; the skeleton cannot be abandoned. If changed: back to "write every layer horizontally first, then find out at the end that they do not connect".
- **Wiring is a fixed item of the review.** The executor writes the call path from the entry point to the new code in "接线证据" (wiring evidence), and the reviewer subagent traces it again itself. When it cannot be traced, the related criteria are judged fail, and a slice with a fail can only be reworked or abandoned, so a slice without wiring cannot be followed by the next one. This is ensured jointly by the review prompt and the refusal in `slice accept`; the script itself does not judge wiring.
- **Only one slice is worked on at a time.** `current` has only one position. If changed: the base commit and the review scope are no longer well defined.
- **Rework happens in the same file.** `slice redo` changes the execution status to "补做中" (rework in progress), adds the round number to the heading of the existing Review part, and appends an empty Review part at the end of the file; when parsing, the last of the parts with the same name is used. If changed: one file per round, or the previous round's review record is lost.
- **A criterion the user verified by hand is recorded as "用户已确认" (confirmed by the user) and treated like a pass.** The reviewer subagent cannot see the user's screen, so it can only judge a criterion that needs running as unverified. Up to 2.0.1 such criteria could only go through "accept as is" (`slice accept --accept-unverified`): the user had looked at the result in the game and said it was fine, yet the reply still said "3 unverified" and made them choose again. Now the orchestrator changes the verdict to "用户已确认" (`verdicts.confirmed` in the spec) once the user confirms, writes the user's words as evidence, and `slice accept` needs no flag. For results the user already saw before review (common in interactive slices), the reviewer's evidence starts with "用户实测: " (`userEvidencePrefix` in the spec) and the orchestrator changes them directly, without asking the user to do it again. "Accept as is" remains only for when the user decides not to verify; failed criteria cannot be accepted. The script does not check whether "用户已确认" is true; this rests on the rules alone. Consequence of changing it: the user finishes verifying and is still told "unverified".
- **Preconditions for manual verification are asked in the plan.** When a criterion needs the user to verify by hand, the account, character, items, and devices it needs go into the plan's "需要决定" (to decide) and are asked before the slice starts; the executor prepares steps and materials only from confirmed preconditions. In a real session the executor built a patch that could only be tested with an item the user did not own, followed by half an hour of looking for substitutes. Consequence of changing it: however clear the steps are, the user cannot perform them.
- **Before adding a slice, ask "what breaks without it" and "is there a cheaper way".** The rule lives in "新增切片之前" in `references/intake.md`; milestone review and requirement changes refer to it, and the cheapest way is the recommended option when asking. In a real session the user mentioned a phenomenon in passing, the orchestrator scheduled a reverse-engineering slice plus an integration slice and recommended the reverse engineering; only after the user had taken four screenshots did it turn out that letting the end user choose was enough. Consequence of changing it: slices nobody needs enter the roadmap, each needing the user's cooperation.
- **Committing is not a state.** After `slice accept`, the orchestrator session invokes commit-message as the output instructs, and the state file is committed with that commit.

### Modularity constraints

- **Module organization is a registered project setting, not inferred each time.** `directories` or `filters`; during intake the script gives a suggestion (by looking for `.sln`, `.vcxproj`, `.csproj`, `.vbproj` in the repository), and the user confirms it. In the default engineering standards pack, each of the two variants occupies one marked block, and `setup` keeps only one block when writing to the project. If changed: within the same project, some slices create directories and others create filters.
- **The constraints land on two fixed items, in the plan and in the review, not just in rule text.** "模块安排" (module layout) in the plan (file, module, layer, description, single definition, reuse) is a hard constraint; the six items of "结构核对" (structure check) in the review are written in `STRUCTURE_CHECKS` in `lib/briefs.mjs`. 1.x had only one line, "规范核查" (standards check), in the review. If changed: the standards are only remembered after something goes wrong.
- **The filters check is the only deterministic modularity check.** It parses `.vcxproj` and `.vcxproj.filters` with regular expressions: every source file item must be assigned to a filter; only files added by this slice are required to lie flat (compared against the base commit), and existing subdirectories are left alone; files outside the project directory and items with wildcards or macros are not checked. No XML library is introduced: runtime scripts use only built-in modules.
- **The verification mode is also a registered project setting.** With `auto`, the reviewer subagent runs the registered commands; with `manual` and `measured`, the prompt states that it does not build or run. 1.x assumed that every project had code check commands, and a project without commands had to take a detour and register a "原因" (reason).

### State and records

- **`state.json` is the single source of the state and is written only by plugin commands.** A write compares the version number, and writes a temporary file first and then renames it. The schema version is 6; earlier schemas are not read.
- **The next action is computed only in `lib/guidance.mjs`.** `status` and the hook's position reminder share it. It needs only the state, plus three things read from the slice file: the execution status, and the row count and classification of the criteria check table. If changed: command output, the hook, and the rule files each say something different.
- **The roadmap view is generated by the script.** `.navigator/roadmap.md` is rewritten every time the state is saved, and the guard rejects direct edits.
- **Decision entries are appended by a command.** `decision add` registers the number and appends the body at the same time, so the two cannot disagree; the requirements file and the backlog are written directly by the orchestrator session.
- **Chinese content is passed to commands through JSON drafts under `.navigator/drafts/`.** Windows PowerShell 5.1 garbles Chinese arguments.
- **No snapshots and no reconciliation.** The records are in Git, and rollbacks and manual edits are visible with git; when things do not agree, `check` reports the problems and the user decides.

### Replies

- **Replies have three layouts and no validation.** The layouts are written only in the "回复" (replies) section of `SKILL.md`: waiting, report, and asking the user to decide or act. The reply types, skeleton commands, and Stop hook of 1.x were all removed: they existed to recognize the user's choice from a reply (the approval in work order review), and the workflow no longer depends on the structure of replies. The cost is that the layouts rely on rules alone. If changed: back to rejections and rewrites.
- **When the user must decide, the question and options come right after the first paragraph, and the options go in a code block.** The 2.0.0 rules were only "conclusion on the first line, progress on the second, options at the end". Real sessions then showed: the question buried under long background; adjacent "A. B. C." lines merged into one paragraph by Markdown; the progress line glued to the first line; every open doubt listed to the user at once during intake. Line breaks inside a code block are never merged, so options always use a code block. If changed: the user has to read the whole reply to learn what to answer.
- **A question box tool must be used when present, but nothing depends on it.** The desktop app offers a question box at the end of a turn (`wrap_up`); the terminal does not. The rule is "when such a tool exists, use it every time, in Simplified Chinese, with buttons matching the options in the code block", and the code block always stays, so replies are complete in both environments. If changed: with the code block alone the desktop app has no buttons to click; with the question box alone the terminal shows no options.
- **Progress goes at the end of the reply, and only when it changed.** On the second line it took the most visible spot in every reply, while its content rarely changed.
- **The same content is written out in full only once; the executor's own report is not relayed when submitting for review.** In a real session the executor's reported results were repeated at submission and again after the review, and the same set of manual steps was sent twice in full.
- **When the user interrupts or raises a question after choosing, answer first; no state change and no commit until they confirm again.** In a real session the user chose "accept and commit", interrupted at once with questions, and the orchestrator committed anyway while answering.

### Installation

- **The hook lives at plugin level and ends immediately in a project that has not been initialized.** `hooks.json` uses the form that does not go through a shell (`"command": "node"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/..."]`). `hook.mjs` ends at once when it cannot read a state file of the current schema, or when the project has been uninstalled; so the hook has no effect on 1.x records before they are archived either. The cost is that in every project with the plugin installed, every write-tool call and every message starts Node once.
- **Commands are invoked through the plugin's `bin/`, written as `project-navigator <command>`.** The `enter` run when the skill loads still uses `node "${CLAUDE_SKILL_DIR}/runtime/navigator.mjs"`, because the PATH of `!` commands is not guaranteed by the documentation; `SKILL.md` sets `allowed-tools` for this.
- **Reference files and the executor guide are output by `ref <name>`.** In the default permission mode, using Read on plugin files outside the project needs the user's approval. `ref executor` appends `shared/punctuation.md` after the guide, so the punctuation rules are maintained in that one file only.
- **The allow rules are written to both `settings.json` and `settings.local.json`, and no broad write is allowed.** The rules are `Bash(project-navigator *)`, `PowerShell(project-navigator *)`, and `Edit(.navigator/**)`. Confirmations for the executor subagent writing business files are handled according to the user's permission mode.
- **Everything in `.navigator/` except drafts is committed, and the ignore rules are checked on entry and at initialization.** `.navigator/.gitignore` re-includes the directories at every level, `.md` and `.json` files, and everything under `findings/`, and finally excludes `drafts/`. When a path in `REQUIRED_TRACKED_PATHS` is ignored by a higher-level rule, the skill stops and reports which rule it is.

## Component map

Entry points and commands:

| File                     | Job                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `runtime/navigator.mjs`  | Command-line entry; parses arguments and dispatches; `enter` ends with exit code 0 in all cases |
| `runtime/hook.mjs`       | Single entry for the three hook events                                                          |
| `commands/handlers.mjs`  | Mapping from command names to handler functions                                                 |
| `commands/init.mjs`      | Initialization; archiving records from the old version                                          |
| `commands/uninstall.mjs` | Removes the allow rules and marks the project as uninstalled                                    |
| `commands/enter.mjs`     | `enter` and `status`: environment check, orchestrator marker, position and next action          |
| `commands/ref.mjs`       | Outputs reference files, the executor guide, and the engineering standards                      |
| `commands/setup.mjs`     | Suggestion and registration of project settings; writes the project standards                   |
| `commands/plan.mjs`      | `roadmap`, `milestone done`, `finish`                                                           |
| `commands/slice.mjs`     | The seven subcommands of `slice`                                                                |
| `commands/brief.mjs`     | Delegation prompts for implementation and review                                                |
| `commands/decision.mjs`  | Registers a decision and appends the entry                                                      |
| `commands/check.mjs`     | Record self-check and filters check                                                             |
| `commands/support.mjs`   | Opens the project, saves the state and generates the roadmap view, reads drafts, commit steps   |

Modules in `runtime/lib/`:

| Group                      | Files                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths and state            | `paths.mjs`, `state.mjs`, `atomic-file.mjs`, `numbering.mjs`, `validation.mjs`, `workflow-error.mjs`                                                |
| Roadmap and slices         | `roadmap.mjs` (roadmap drafts, milestones), `slice-flow.mjs` (slice state transitions), `slice-file.mjs` (slice file skeleton, reading, digest)     |
| Generation                 | `guidance.mjs` (next action and progress), `briefs.mjs` (delegation prompts), `roadmap-view.mjs` (roadmap view), `decisions.mjs` (decision entries) |
| Project settings           | `project-settings.mjs` (suggestion, validation, generation of the project standards), `filters.mjs` (filters check)                                 |
| Guard and identity         | `guard.mjs` (the four write rules), `orchestrator-marker.mjs` (recognizes the orchestrator session by the transcript)                               |
| Parsing                    | `markdown.mjs`, `table.mjs`                                                                                                                         |
| Repository and environment | `repo.mjs`, `environment.mjs`, `version.mjs`, `settings.mjs`                                                                                        |

`tests/project-navigator/` holds the automated tests.

## Troubleshooting

| Symptom                                                                                               | Root cause                                                                                                                                                                               | Related files                                | How to verify                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Invoking the skill aborts at once, reporting that a permission check failed                           | `allowed-tools` was deleted or rewritten                                                                                                                                                 | `SKILL.md`                                   | Invoke it once in the default permission mode                                                    |
| Running `project-navigator` reports that the command is not found                                     | The plugin is not enabled, or the session started before the plugin was updated; `.cmd` is not found in PowerShell                                                                       | `bin/`                                       | `claude plugin list` to see whether the plugin is enabled; restart the session                   |
| Plugin commands or record writes pop up permission prompts                                            | The local configuration lacks the allow rules, or the command does not start with `project-navigator`                                                                                    | `lib/settings.mjs`                           | The "放行规则" (allow rules) line of `status`; run `init` again                                  |
| On entry, it says the records were written by an old version                                          | The `schema` of the state file is less than 6                                                                                                                                            | `commands/enter.mjs`, `commands/init.mjs`    | Run `init --archive` after the user agrees                                                       |
| The orchestrator session is refused when writing files outside `.navigator/`                          | This is rule 4; when a change is needed, put it into a slice                                                                                                                             | `lib/guard.mjs`                              | Drive `hook.mjs` through standard input, with an orchestrator session's transcript               |
| A session that is not the orchestrator session is refused when writing business files                 | This project's orchestrator marker appears in the session transcript, for example because the session once invoked the skill                                                             | `lib/orchestrator-marker.mjs`                | Search the transcript for "project-navigator 编排标记" (project-navigator orchestrator marker)   |
| The executor subagent is refused when writing orchestration records                                   | Under `.navigator/` only the slice file in progress and `findings/` can be written                                                                                                       | `lib/guard.mjs`                              | The refusal reason states the writable scope                                                     |
| `slice start` says the Plan part is not filled in                                                     | A section is empty or still contains "(待填写" ("(to be filled in"); the completion criteria are not a numbered list                                                                     | `lib/slice-file.mjs`                         | `check` lists the sections that are not filled in                                                |
| `slice start` mentions a needed decision                                                              | "需要决定" (needs decision) is not a single line "无" (none)                                                                                                                             | `commands/slice.mjs`                         | After asking the user and writing in the answer, run with `--decided`                            |
| The executor subagent has ended, but `status` still says waiting                                      | It did not change "执行状态" (execution status) to "完成" (done), or wrote it in another section                                                                                         | `lib/slice-file.mjs`, `lib/guidance.mjs`     | Look at the "执行结果" (Result) part of the slice file; use SendMessage to ask it to fill it in  |
| `slice review` says the Plan part was changed                                                         | The content of the Plan part changed after work started: the orchestrator session changed it according to the user's answer, or the executor subagent changed it by mistake              | `digestPlan` in `lib/slice-file.mjs`         | `git diff` on the slice file; in the former case run `slice replan`                              |
| The Review part is written, but `status` still says waiting for review                                | The criteria check table still has placeholders, or is not a valid table                                                                                                                 | `readVerdicts` in `lib/slice-file.mjs`       | There must be a separator row under the header, and three cells per row                          |
| `slice accept` is refused                                                                             | A section of the Review part is not filled in; a verdict is not one of the four; there are fewer rows than completion criteria; there is a fail; there is an unverified without the flag | `commands/slice.mjs`                         | The error message states each one                                                                |
| `slice plan` is refused, mentioning the walking skeleton                                              | The skeleton slice has not passed review yet                                                                                                                                             | `lib/slice-flow.mjs`                         | The line in `roadmap.md` that carries "最小骨架" (walking skeleton)                              |
| `roadmap` is refused, mentioning a missing slice that has already started                             | The draft does not carry the `id` of an existing slice                                                                                                                                   | `lib/roadmap.mjs`                            | Compare with `roadmap.md` and give the existing entries their `id`                               |
| The filters check misses something or reports a false positive                                        | The project file uses wildcards, macros, or a form the regular expressions do not cover                                                                                                  | `lib/filters.mjs`                            | The count of "没有检查" (not checked) items in the output; reproduce with a minimal project file |
| init outputs "设置结果: 未执行" (setup result: not run), or on entry it says records would be ignored | The project's ignore rules ignore files under `.navigator/` or `.claude/` that must be committed                                                                                         | `commands/init.mjs`, `lib/paths.mjs`         | `git check-ignore -v --no-index <path>`                                                          |
| The hook still produces output after uninstalling                                                     | `init.status` in the state file is not `uninstalled`                                                                                                                                     | `commands/uninstall.mjs`, `runtime/hook.mjs` | Look at `init` in `state.json`                                                                   |

## Change process

| What changed                                | What else to do                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sections in `spec/slice.json`               | The section `id`s are referenced by `SECTIONS` in `lib/slice-file.mjs`, and `slice-file.test.mjs` checks that the two agree; check the section names referenced in the rule files |
| Refusals by workflow rules                  | Always throw `WorkflowError`, with an error message written in Chinese that can be acted on as it stands                                                                          |
| The next action                             | Change only `lib/guidance.mjs`; the rule files do not repeat "when to run which command"                                                                                          |
| Delegation prompts                          | Change only `lib/briefs.mjs`; the executor guide covers how to work, and the prompt covers the facts of this slice and the handback format                                        |
| `standards/engineering.md`                  | Each of the two module organization variants sits between a pair of `<!-- begin:x -->` and `<!-- end:x -->`; `docs.test.mjs` checks that both can be generated                    |
| The structure of the state file             | Bump `STATE_SCHEMA_VERSION`; decide whether to migrate or archive, and update how `init` and `enter` handle the old structure                                                     |
| Adding or renaming a plugin command         | Register it in `commands/handlers.mjs`; update the command quick reference in `SKILL.md` (checked by `docs.test.mjs`), and the options and file header comment of `navigator.mjs` |
| The plugin command name `project-navigator` | `COMMAND_NAME` in `lib/paths.mjs`, the two files in `bin/`, the allow rules in `lib/settings.mjs`, the documentation                                                              |
| `SKILL.md`                                  | The length check and routing table check in `npm test`; smoke test with `claude -p --plugin-dir`                                                                                  |
| Subagent names                              | `SUBAGENT_TYPES` in `lib/guard.mjs` and `SKILL.md`; `docs.test.mjs` checks that the definition files exist                                                                        |
| The plugin name `waypoint`                  | `SUBAGENT_TYPES`, `COMMIT_SKILL`, the `/waypoint:` commands in the documentation                                                                                                  |
| `shared/punctuation.md`                     | No extra step: `ref executor` reads it at run time                                                                                                                                |

## Tests

`npm test` runs all tests in `tests/project-navigator/`:

| File                  | Coverage                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow.test.mjs`       | Walks the slice loop in a temporary repository with the command line and the hook: skeleton, accepting unverified, rework, interactive slice, milestone review, wrap-up, the guard's four rules, position reminder, filters |
| `cli.test.mjs`        | Entry and initialization, archiving of old-version records, ignore-rule check, uninstall, `ref`, project settings and generation of the project standards, preconditions of the roadmap, decisions                          |
| `roadmap.test.mjs`    | Merging of roadmap drafts, skeleton, one slice at a time, state transitions, milestone completion and wrap-up, next action during intake                                                                                    |
| `slice-file.test.mjs` | Agreement between the spec and the script's references, skeleton, parsing, plan digest, sections not filled in, criteria check table, archiving on rework                                                                   |
| `filters.test.mjs`    | Assignment to filters, flat layout of added files, wildcards and files outside the project                                                                                                                                  |
| `settings.test.mjs`   | Merging and removal of allow rules, wiring of the plugin's `hooks.json` and `bin/`                                                                                                                                          |
| `docs.test.mjs`       | The length of `SKILL.md`, and its routing table and command quick reference agreeing with the actual files and commands; the two variants of the engineering standards; subagent definitions                                |
| `markdown.test.mjs`   | Markdown parsing                                                                                                                                                                                                            |

## Measured findings

### Design basis of 1.0.0 (Claude Code 2.1.321, Windows 10, 2026-11-10)

Measured in `claude -p --plugin-dir` with a probe plugin containing only a hook, `bin/`, and one subagent, on a path containing spaces and Chinese characters. 2.0.0 still depends on these findings:

| Point to verify                            | Finding                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin-level hook                          | Both the exec form and the shell form in `hooks.json` fire, and `${CLAUDE_PLUGIN_ROOT}` expands correctly                                                                                         |
| Subagent identity                          | The PreToolUse input of a plugin subagent carries `agent_id` and `agent_type: "<plugin>:<name>"`                                                                                                  |
| Transcript                                 | The PreToolUse input carries `transcript_path`; at the first tool call the transcript already contains the marker from this turn; scanning a transcript of about 0.5 MB takes 1 to 2 milliseconds |
| Plugin `bin/`                              | The Bash tool can run a script with no extension directly (Git Bash), and the PowerShell tool runs the `.cmd` of the same name                                                                    |
| Background subagents                       | Headless mode waits for background subagents to end and handles the results; in the desktop app, the completion notification of a background subagent wakes the main session automatically        |
| Subagent resumption                        | SendMessage lets an ended subagent continue with its original context                                                                                                                             |
| Subagent write permission                  | In headless mode, writes are refused when there is no allow rule; a bare `Edit` rule does not allow Write, and `Edit(**)` allows writes by foreground and background subagents                    |
| Default permission mode in the desktop app | Write confirmations of a background subagent pop up in the main session ("Allow Claude to write x.txt?", without saying it is a subagent); "Always allow" switches the session to Accept edits    |

Official documentation (2026-11-10): the plugin's `bin/` is on the PATH of the Bash tool, after the user's PATH; plugin subagents do not support `hooks`, `mcpServers`, or `permissionMode`; a skill's `allowed-tools` is in effect only for the turn that invokes the skill.

### Earlier findings (Claude Code 2.1.280 to 2.1.284)

| Point to verify           | Finding                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!` commands in a skill   | Without `allowed-tools`, the whole invocation aborts in default mode; PreToolUse does not fire                                                                                           |
| The skill's `shell` field | When Git Bash cannot be found in a child session, a skill with `shell: bash` fails outright                                                                                              |
| Denial in bypass mode     | `permissionDecision: "deny"` from PreToolUse still takes effect                                                                                                                          |
| Context injection         | The model can read the `additionalContext` returned by UserPromptSubmit; slash commands also fire this event                                                                             |
| Allow rules               | Allow rules in the project's `settings.json` need workspace trust and do not take effect in headless mode; `settings.local.json` does not need it; an `Edit(...)` rule also covers Write |
| Session forking           | `--fork-session`, and rewinding or resending after an interrupt in the desktop app, all change the session id, and the forked transcript copies the original session's history           |
| Parallel hooks            | All hooks for the same event run in parallel, and Claude Code waits for all of them to end before continuing                                                                             |

### Smoke test for 2.0.0 (Claude Code 2.1.319, Windows 10, 2026-11-12)

A "command-line to-do tool" was run through in a temporary repository with `claude -p --plugin-dir` and `--continue`: initialization, intake, the roadmap, and the first slice (the walking skeleton) from plan through implementation, submission, and review, up to asking the user to decide.

| Point to verify                        | Finding                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invocation with the `init` argument    | Initializes and commits directly; the first wording still made the model ask, so the next action of `enter` and `SKILL.md` now say so explicitly           |
| Intake                                 | Wrote the requirements file, registered the project settings, laid out a roadmap of the skeleton plus two vertical slices, and committed as the step said  |
| Plan                                   | The "模块安排" (module layout) listed files, modules, layers, and single definitions by physical directory; with nothing to decide, the slice started      |
| Executor subagent                      | Wrote only business files and the Result part; the wiring evidence gave the step-by-step call path from the entry point to the data layer; two corrections |
| Plan digest                            | The formatter hook re-aligned the table in the Plan part, the digest did not change, and `slice review` passed                                             |
| Review                                 | After the reviewer subagent handed back, the orchestrator session wrote the Review part and asked the user to choose between two options                   |
| Replies                                | Without validation, replies kept the conclusion on the first line and the progress on the second                                                           |
| Interrupted session (headless timeout) | The next `--continue` turn resumed from the state and went on with the review                                                                              |

A caveat for smoke testing: a child process started from a session that already has this plugin installed inherits the installed version's `bin/` on its PATH, so the old commands run. Remove that directory from PATH first.

Not verified in a real session:

- Resuming with SendMessage after a handback, and a rework round.
- An interactive slice, and how much of the orchestrator session's context it uses.
- A Visual Studio project that expresses modules as filters.
- Projects verified as `manual` or `measured`.
- Behavior in the desktop app.

Problems met in real projects after the release are to be added to the troubleshooting table.

## Pre-release manual tests

In a temporary repository, confirm each item with `claude --plugin-dir ./plugins/waypoint`:

### Initialization and sessions

1. When not initialized, the skill asks whether to initialize; after agreement, init writes the state directory and the allow rules, and commits as the output instructs; on disagreement nothing is changed. In a repository that has not been initialized, writing files is not restricted in any way.
2. The `project-navigator` command runs in both Bash and PowerShell without a permission prompt.
3. A new session invokes the skill and continues from the records; the original session remains usable as before.
4. After context compaction, the orchestrator session receives the position reminder.
5. After uninstalling, the allow rules are removed, writing business files is no longer refused, and the records are kept.
6. Invoke the skill in a project initialized under 1.5.0: it explains that old records are not read; after agreement, `init --archive` runs, and the old directory is renamed to `.navigator-1.x/` with its contents unchanged.

### Intake

1. The skill restates the requirement, confirms the open questions one by one, and writes the requirements file.
2. The suggestion from `setup`: `filters` for a repository with `.vcxproj`, `directories` for the rest; after registration, `.claude/rules/engineering.md` contains only the matching variant.
3. The first slice of the roadmap is the walking skeleton; writing the first slice as `findings` is refused.

### Slice loop

1. The orchestrator session read the relevant code before writing the plan; "模块安排" (module layout) in the plan is written according to the registered organization (directories or filters).
2. When the plan has nothing pending, work starts right away; when it does, the user is asked first and work starts with `--decided`.
3. While the executor subagent works in the background, you can keep talking to the orchestrator session; after it ends, the orchestrator session carries on automatically.
4. The executor subagent needs an action from the user: it hands back "交回: 需要操作" (handback: needs an action), the orchestrator session relays it unchanged, the same subagent continues after the user replies, and the slice status stays "实现中" (implementing) throughout.
5. Deliberately write one wrong detail in "工作假设" (working assumptions) in the plan: the executor subagent does not hand back, finishes the work to what is actually there, and the "修正" (corrections) table has one row; "修正核对" (corrections check) in the review describes this correction.
6. The executor subagent tries to change the Plan part: `slice review` refuses to submit for review.
7. Deliberately leave the new code unconnected to the entry point: the wiring check in the review points it out, and the related criteria fail; they pass after rework.
8. A project whose verification mode is `manual`: the reviewer subagent does not build or run, criteria that can only be confirmed by running are judged unverified with the steps written out; after the user confirms them the orchestrator changes the verdicts to "用户已确认" and accepts without the flag.
9. In a Visual Studio project, add a source file that is not assigned to a filter: the filters check in the review prompt points it out.
10. Interactive slice: no executor subagent is dispatched, the orchestrator session does the work directly, and the findings are written to `.navigator/findings/`; a new session that invokes the skill can continue; the orchestrator session is still refused when writing business files.
11. The reviewer subagent is refused when it tries to write a file.
12. After the review passes, the work is committed; when the user chooses to push, it is pushed as well.
13. An idea outside the current slice comes up in discussion: it is recorded in `backlog.md` and is not done on the side.

### Milestones, changes, and wrap-up

1. After all slices of a milestone have ended, the milestone review starts and the slices of the next milestone are laid out.
2. Requirement change: the requirements file and the roadmap are updated and a decision is recorded; slices that have already started are kept.
3. After all milestones are complete, wrap up and commit as the output instructs; `git status` is clean; adding a milestone afterwards lets the work continue.

## Known limitations

- The guard only checks the target paths of write tools: writing files from the command line or a scripting language, installing dependencies, and running plugin commands that change state are all unchecked and rely only on the skill's rules.
- Recognizing the orchestrator session depends on the marker in the transcript, and the transcript format is internal to Claude Code; when the transcript cannot be read, rule 4 does not take effect (the write is allowed).
- Ownership of the parts can only be detected after the fact: when the executor subagent changes the Plan part, it is not pointed out until `slice review`.
- The wiring check and the structure check (except the filters check) are judged by the reviewer subagent and are not deterministic.
- No script checks whether the code was read before the plan was written.
- The reply format relies only on rules.
- An executor subagent belongs to the session that started it, and its work is interrupted when the session closes; a new subagent can only continue from "中途记录" (interim notes) and the changes already in the working tree.
- Write confirmations of a background subagent do not say that it is a subagent.
- The filters check covers only the forms the regular expressions can recognize.
- The plugin's hook fires in every project, and every write-tool call and every message starts Node.js one more time.
