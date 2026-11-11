# Changelog

All notable changes to the WayPoint plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged as `waypoint--v<version>`.

## [Unreleased]

### Added

- `project-navigator`: the skill notices its own problems and reports them. The scripts record internal errors in commands and hooks, an inconsistent state, a command that the next action asked for but that was refused, and the same next action given 4 times while the state does not change. `status` and the reminder on each user message then show a "技能异常" (skill anomaly) line.
- `project-navigator`: a new `report [--from <draft>]` command and a new reply "问题报告" (problem report). The command writes `.navigator/drafts/reports/report-NNNN.md` (not committed) from the recorded anomalies, the environment, a state summary, and the course of events in the draft, and the reply shows the full text in one code block for the user to pass to the maintainers. A report states only what happened: no guesses about causes, no advice, no work order text or business code, and local paths are masked. Orchestration pauses only when it cannot continue, that is, after an internal command error or with an inconsistent state.

## [1.0.0] - 2026-11-11

This release reworks `project-navigator` and is not compatible with projects initialized by 0.x: invoke the skill in such a project and run `init` when asked. The upgrade removes the old project-level hooks, permission rules and script copies; all records are kept.

### Added

- `project-navigator`: work orders are carried out by a new executor subagent, `waypoint:navigator-executor`, which the orchestrator dispatches in the background with the prompt from a new `exec-brief` command. When it finishes, the orchestrator is notified and continues on its own. Users used to open a second session, paste a launch prompt, confirm a kickoff alignment and choose how to report back.
- `project-navigator`: a new reply "工单执行" (order running) shown while the executor works, and a new reply type layout: a one-line "结论:" (conclusion) under the heading, written for a reader with little time, then a single progress line such as `阶段 5/6 (切片) · 里程 3/5 (...) · 切片 4/10 (...) · 工单 0007`, then the sections and the option block.
- `project-navigator`: the plugin ships its hooks in `hooks/hooks.json` and a `project-navigator` command in `bin/` (with a `.cmd` for PowerShell). Hooks do nothing in projects that are not initialized. Commands are now `project-navigator <command>` instead of `node .navigator/bin/runtime/navigator.mjs <command>`.
- `project-navigator`: `ref <name>` prints a reference file, the executor guide (`executor`) or the engineering standards (`standards`) from the plugin, so nothing is copied into the project.
- `project-navigator`: work orders have a "审阅要点" (review points) section written for the user: goal, decisions needed, out of scope, and why the order has this size. "工单审阅" (order review) now shows only these points and the file path, prefilled by `reply approve`, instead of quoting five sections of the order.
- `project-navigator`: "调研报告" (research report) has an option to skip brainstorming and draft the brief directly.
- `project-navigator`: when a blocked order is unchanged after the user acts, `order set issued` continues without a new review and tells the orchestrator to resume the same executor with SendMessage.
- `project-navigator`: `order set accepted --accept-unverified` lets the user accept an order whose only open verdicts are unverified, through a new third option group of "验收报告" (review report). Unverified criteria used to always fail the order.

### Changed

- `commit-message`: a bare `/waypoint:commit-message` (no argument, no other text) now includes every change, unstaged and untracked files included, and commits right after showing the message, without asking and without pushing. Plain-language requests and invocations with an argument keep the previous behavior. The secret file warning still applies.
- `project-navigator`: a work order now needs two user decisions: publish it in "工单审阅" (order review) and accept and commit it in "验收报告" (review report). The replies "工单发布", "等待回执", "测试授权", "确认提交" and "阶段提交" are gone; the commit choice is part of the review report, and committing records after a stage, initialization or closing is a step in the command output.
- `project-navigator`: the guard checks only four things, all by write path: nobody writes `state.json` or the generated roadmap and risk views directly; the reviewer writes nothing; the executor writes only its own receipt and `artifacts/` under `.navigator/`, and no business files on run-check and analysis orders; the orchestrator writes only under `.navigator/`. Shell commands, tool whitelists, delegation prompts and record structure are no longer checked at write time.
- `project-navigator`: the Stop hook checks only the structure of the orchestrator's replies (heading, conclusion line, option block). Writing rules and length are suggestions shown before the skeleton; `check <file>` reports structure problems for self-checks without numbering a checkup.
- `project-navigator`: sessions are no longer registered. The orchestrator is recognized by a project-specific marker that the skill's entry output leaves in the session transcript, so any session that invokes the skill continues from the recorded state, and forked sessions keep working without re-registering.
- `project-navigator`: work order size is decided by four limits (one executor run, one review, runnable afterwards, risky parts separate) instead of "at most 5 criteria"; a slice is one order by default, and each criterion checks one thing. A rejection asks whether the order was too large before issuing a fix order.
- `project-navigator`: the orchestrator may recommend technologies; only key dependencies go through selection orders.
- `project-navigator`: the engineering standards drop "modules: finer is better" in favor of splitting by responsibility without splitting ahead of need.
- `project-navigator`: the reviewer runs the code checks and the receipt's test commands except those the executor lists under the new "外部影响" (external effects) key, and uses MCP tools named in the receipt for read-only queries. Test authorization, `order tests`, `tools set` and `user-tests.md` are gone.

### Removed

- `project-navigator`: snapshots and reconciliation (`snapshots`, `restore`, `adopt`, the "验收异常" reply), the commit settlement record, `stagecommit`, `address set`, `init --verify`, executor sessions with kickoff alignment, and the human summary block at the end of replies and records.

## [0.11.0] - 2026-11-08

### Added

- `project-navigator`: a new work order kind, `analysis`, for hands-on investigation such as reverse engineering or research that produces documents and evidence scripts. Such tasks used to borrow `runcheck`. Like run-check orders, analysis orders need no check commands and can be issued in any stage.

### Changed

- `project-navigator`: run-check and analysis orders now only produce records, and the guard enforces it: their executor sessions can write only the receipt and the order's `artifacts/`, and writes to business files or `.claude/settings.json` are denied with a reason that points to an implementation order. "Changes no files" used to be only a sentence in the survey instructions. Their launch prompts state the narrower scope, and the reviewer marks the wiring check as not applicable instead of tracing new code from the entry point.
- `project-navigator`: `order new --kind implementation` and `--kind fix` are refused while no check commands are registered, with the same instructions `reply approve` gave. The problem used to surface only after the order file was written.
- `project-navigator`: option A of the second option group of "验收报告" (review report) now reads "补正工单, 立即发布." (follow-up order, issue now), since the follow-up is not always a fix order.

### Fixed

- `project-navigator`: a rejected run-check or analysis order now leads to a new order of the same kind in the same slice. `order set rejected` used to suggest a fix order, which cannot be issued before check commands are registered, so a run-check rejected during survey or before selection had no way forward.

## [0.10.0] - 2026-11-08

### Changed

- `project-navigator`: a selection now answers one question, whether the chosen library can do each requirement listed in the order, and is reviewed in one round. The selection receipt has a new "需求核对" (requirement check) table with one row per requirement, the answer "能" (yes) or "不能" (no), and its basis: source evidence, or a temporary test the executor writes under the order's `artifacts/` when the source does not show it. The "能力核实" source table may now contain only its header. The reviewer checks only the requirement table, fetching source with `evidence` or rerunning the tests, and skips the wiring check. Other statements in the receipt need no evidence.
- `project-navigator`: after review, a selection order uses a new fourth option group of "验收报告" (review report): adopt the conclusion or choose another option. It no longer asks for manual verification, and `order set accepted` no longer requires every verdict of a selection order to pass, only the user's conclusion; requirements that did not check out are recorded as risks. A new selection order follows only when the user chooses another option. Selections used to be reviewed like other orders: anything unverified failed and led to another selection order, and in a reported project one question went through six rejected orders without converging.
- `project-navigator`: the selection guide in the engineering standards asks for an answer per requirement, backed by source or a temporary test, instead of source evidence for every key capability.

## [0.9.0] - 2026-10-01

### Changed

- `project-navigator`: executor sessions (after alignment) and ordinary sessions can now wire a project's own hooks in `.claude/settings.json`. The guard used to deny every change to this file, so a work order that needed a hook, such as running the code checks after an edit, ended with the executor handing the snippet to the user to merge by hand. The guard now checks the content of the write: only the `hooks` field may change, the plugin's own hook groups must stay as they are, and a new hook must be a group of its own. Changes to other settings (such as permission rules), to `.claude/settings.local.json`, to `.claude/rules/engineering.md`, and command-line writes are still denied, and the denial says what may be changed.
- `project-navigator`: the executor guide has a section "受保护的文件" (protected files) listing what an executor cannot change under `.claude/` and how to wire a hook, and the work order instructions tell the orchestrator which of these changes a work order may ask for. The guide used to mention the restriction only in passing, and overstated it as the whole `.claude/` directory.
- `project-navigator`: `address set` refuses an orchestrator address without the ref in square brackets, such as a bare "编排会话".

### Fixed

- `project-navigator`: a message report now reaches the orchestrator when other sessions on the machine share its name. The registered address already carried the session's ref, as in "编排会话 [b76883]", but the executor guide said to send to the session name and to fall back to a document report whenever more than one session had that name, so with one orchestrator per project the message report was given up almost every time and the user had to go back to the orchestrator and choose A. The executor now checks that a ListAgents row matches the registered address exactly and sends to the full address; it falls back only when no address is registered, no row matches (the orchestrator session was closed or restarted), or sending fails.

## [0.8.1] - 2026-10-01

### Changed

- `project-navigator`: confirming the project closing with `finish` always requests a stage commit. It used to skip the request when the `state.json` in `HEAD` already recorded the project as finished, a case the completed-project handling added in 0.8.0 covers.

### Fixed

- `project-navigator`: upgrading an initialized project now really replaces the runtime scripts. The next action on entry said only "run init", and the orchestrator ran `init` from the copy in `.navigator/bin/` instead of the script in the skill directory; the copy skipped the copying because its source was itself, and still printed "已升级" (upgraded) with the old version. The project stayed on the old scripts with no further notice, so fixes released later never took effect: a project left at 0.7.4 kept returning to "项目收尾" (project closing) after the closing, kept a modified `state.json`, and had no "自由答复" (free-form answer) reply, all of which 0.7.5 and 0.8.0 had fixed. The next action on entry now prints the full command with the path of the skill directory and the session id, and the project copy refuses to run `init` (except the self-check, `init --verify`), stating the correct command and changing nothing. A project in this state is upgraded by invoking `/waypoint:project-navigator init` again.

## [0.8.0] - 2026-09-30

### Added

- `project-navigator`: a "项目完成" (project complete) reply for a completed project whose records are all committed. It shows the last record commit, the working tree, and how far the branch is ahead of the remote, with options to continue iterating, push to the remote, or do nothing.
- `project-navigator`: a "自由答复" (free-form answer) reply for requests outside the workflow, such as an explanation or an issue report for the maintainers. Its single section is written in the format the user asks for, may contain code blocks, and is not sent back under the writing rules; the progress section, options, and human summary are still checked.

### Changed

- `project-navigator`: after the project is complete and its records are all committed, the orchestrator may run `git push` without force options. At other times outside the commit step, pushes are still denied, and the denial now says when pushing is allowed and that the user can run it.

### Fixed

- `project-navigator`: `state.json` no longer ends up modified again after the project closing. The next action after the closing still asked for "项目收尾" (project closing), whose option A runs `finish` again; that `finish` requested no stage commit but wrote the settled state back into `state.json`, and adopting a manual commit wrote it again, so the working tree never became clean. After completion, the next action is now "项目完成"; `finish` writes nothing when the records are all committed, and requests the stage commit "项目收尾后的记录更新" (records updated after closing) when they are not. A project that already has the leftover change is told to run `finish` and commits it through that stage commit.

## [0.7.5] - 2026-09-29

### Fixed

- `project-navigator`: finishing a commit step no longer leaves `state.json` modified in the working tree. `stagecommit start` and `order set committing` write `state.json`, the commit includes it, and `stagecommit done` or `order set committed` then rewrote the same file to record the new commit, a hash that cannot be known before the commit exists. The change was normally carried by the next commit, but after the project closing no commit follows, so a finished project kept an uncommitted `state.json`. Finishing a commit step now records which commit completed it in the local registry (`.git/navigator/commit-settlement.json`) instead of rewriting `state.json`; commands and hooks read the state as settled, and the settled state is written with the next state change. A project that already has the leftover change clears it with the stage commit that follows the upgrade.

## [0.7.4] - 2026-09-28

### Fixed

- `project-navigator`: the finished marker that `finish` writes to `state.json` is now always committed. `finish` requested a stage commit only when skill files other than `state.json` were uncommitted, so when the closing records had already been committed (for example by hand while recovering from the 0.7.2 bug), the marker stayed in the working tree with no way to commit it: the next action said the closing was confirmed, `stagecommit start` found no stage commit, and the guard denied `git add`. `finish` now also requests a stage commit while the `state.json` in `HEAD` does not yet record the project as finished.

## [0.7.3] - 2026-09-28

### Fixed

- `project-navigator`: the closing records of a project can now be committed when the user confirms the closing. Stage commits were requested only when entering a stage, but the "项目收尾" (project closing) section of `milestone-reviews.md` is written after entering stage 6, the last stage; after the user chose A, the record stayed in the working tree, the next action still said to continue stage 6, `stagecommit start` found no stage commit, and the guard denied `git add`. The new `finish` command, run after A, marks the project as finished and requests a stage commit when skill files are uncommitted; the next action then says the closing is confirmed.

## [0.7.2] - 2026-09-28

### Fixed

- `project-navigator`: a freshly initialized orchestrator is now asked to register its address. The "地址登记" (address registration) line appeared only when `enter` took over without stopping at setup, so the first invocation, which always stops at "初始设置" (initial setup), never showed it, and `init` and `status` did not either; message reports therefore always fell back to a document report. While no address is registered, the orchestrator now gets the registration steps with every message and at session start.
- `project-navigator`: `template` prints fill-in requirements before the skeleton, as `reply` does: one line per key in keyed sections such as "测试记录" (test record), with nothing else under them, and which sections can hold tables and multi-line content. Before, only the write check knew the rule, so an executor that put a table under a key had its first write blocked. The executor guide and `files.md` state the same rule.

## [0.7.1] - 2026-09-27

### Fixed

- `project-navigator`: rewinding, editing, or resending an interrupted message of an executor session in the desktop app no longer strips its executor rights. The forked session continues under a new session id; it now keeps the executor registration through the executor marker in its transcript, with the alignment state as of the fork point. Before, the forked session was treated as unrelated, writing `receipt.md` was denied, and the work order was stuck at the report. Executors started with 0.7.0 or earlier carry no marker; if one is not recognized after a fork, resend the launch prompt in the same session.
- `project-navigator`: plugin commands with harmless redirects or pipes, such as `status 2>&1 | head -40`, are no longer denied as command-line writes to `.navigator/`. The check now ignores the plugin script path after node and redirects that write no file, while `... > .navigator/<file>` is still denied.
- `project-navigator`: denials for sessions that are neither orchestrator nor executor say that an executor recognized as unrelated can resend the launch prompt in the same session, instead of asking for a new session.

## [0.7.0] - 2026-09-27

### Changed

- `project-navigator`: the review record skeleton prefills "用户结论" (user verdict) and "提交方式" (commit choice) with "待用户确认" (awaiting the user), and `order set accepted` and `order set committing` refuse until the orchestrator writes down your choice. Before, the write check rejected the unfilled keys, so the orchestrator had to invent values before you had chosen.

### Added

- `project-navigator`: stage commits. After initialization, and whenever a stage begins while the previous stage left uncommitted records, the orchestrator replies with the new "阶段提交" (stage commit): commit only the skill's files, commit them together with every other change, or skip for now. Committing goes through `commit-message` as usual, and `stage` and `order new` wait until you answer. Before, the orchestrator could commit only after a work order was accepted, so initialization and framing outputs stayed uncommitted until the first work order, and a repository without any commit could not get a work order at all; it now gets its first commit here. Projects initialized with an earlier version should run `init` again to upgrade.

### Fixed

- `project-navigator`: `order new` without `--slice` attaches the work order to the current slice. Before, such a work order belonged to no slice, so it was missing from the roadmap and did not count toward "two failed reviews in one slice, split it again"; the orchestrator also tended to pass the position shown as "2/9" instead of the slice id, and the error now lists the valid ids.
- `project-navigator`: the next action printed by `order new` asks for "工单审阅" (work order review) before issuing, as the workflow requires.
- `project-navigator`: when no work order is current, "当前工单" (current work order) shows the last one and how it ended, for example in the review report of a rejected work order.
- `project-navigator`: denials of compound commands and of `git -C <dir>` explain the allowed form, for the reviewer subagent as well. Before, the reviewer was told it may run only read-only git commands, retried the same read-only commands, and was denied again.
- `project-navigator`: rewinding or editing a message of the orchestrator in the desktop app no longer locks orchestration. Such a rewind, like `--fork-session`, continues the conversation under a new session id; the forked session is now recognized from the orchestrator marker in its transcript and takes over automatically. Before, every plugin command was denied, and the reply claimed that another session had taken over.
- `project-navigator`: message reports reach the current orchestrator. The orchestrator registers its address with the new `address set` command whenever it takes over or resumes, `status` shows it as "编排地址" (orchestrator address), and the executor sends to that address; with no address or a failed send, the executor writes the receipt file and asks you to choose A in the orchestrator. Before, the address was written into the work order, where it went stale after a restart or takeover and could not be corrected once the work order was issued.

- `project-navigator`: a receipt or review record rewritten by a formatter hook no longer reports "状态目录与快照不符" (state directory does not match the snapshot). A write under `.navigator/` now only leaves a marker, and the file enters the snapshot once every hook of that tool call has finished: before a plugin command reconciles, and when you send a message, a session starts, or a reply ends. Before, the plugin snapshotted the file while your formatter was still rewriting it, so every work order stopped at "验收异常" (reconciliation anomaly) at least once.
- `project-navigator`: a manual commit in the middle of orchestration is reported instead of being absorbed silently. Commands that change the state now also compare the commit history outside the commit step, and refuse while foreign commits, rollbacks, or divergence are unhandled; `status` then leads to "验收异常". Before, only a new session noticed such commits, and in the same session the next `order set committed` took them into the records without asking.

## [0.6.0] - 2026-09-26

### Added

- `project-navigator`: a work order is reviewed before it is issued. After writing the work order, the orchestrator replies with the new "工单审阅" (work order review), quoting the overview, scope, premises, rules, and every acceptance criterion straight from the work order file; the hook checks the quote against the file. The work order can be issued only after you choose A, and only with the exact content you approved: editing it afterwards, or reissuing it after it was blocked, needs another review. Before, "工单发布" (work order issued) showed only the path and the number of criteria, next to the launch prompt.
- `project-navigator`: an issued work order can be withdrawn for changes. Choosing B in "工单发布" or "等待回执" (awaiting receipt) now withdraws the work order with `order set drafting`; after the change is reviewed and issued again, the round increases, the old receipt is archived, and the executor has to align again. Before, the work order was edited in place while an executor might already be working from the old version.

### Fixed

- `project-navigator`: rolling back `.navigator/` with git no longer downgrades the running orchestrator session. The orchestrator is now registered on your machine in `.git/navigator/orchestrator.json` instead of in `state.json`, so `git reset` or `git checkout` cannot change who orchestrates. Before, a rollback brought an older session back into `state.json`; the running orchestrator could no longer write records, was told to paste a launch prompt, and could still change the state through commands. Projects initialized with an earlier version should run `init` again to upgrade; the existing registration is migrated.
- `project-navigator`: a rollback or manual edit of the records is always reported. Snapshots now take in only the files written by the plugin or by sessions under the hooks, instead of the whole state directory at the end of every reply and command, and reconciliation also compares the snapshot when it finds the plugin's own commit. Commands that change the state refuse while the records differ from the snapshot. Before, `git reset --hard` to the last commit was absorbed into the next snapshot and `status` reported "一致" (consistent).
- `project-navigator`: executor sessions and other sessions can run only the read-only plugin commands (`status`, `reply`, `template`, `evidence`, `snapshots`). Before, any session could change the orchestration state through the allow-listed commands, for example an executor accepting its own work order.
- `project-navigator`: a session whose orchestration was taken over is told so when you send it a message, and its denials say how to take orchestration back instead of asking it to paste a launch prompt.

## [0.5.0] - 2026-09-25

### Added

- `project-navigator`: evidence files for a work order. After alignment, the executor can write files such as raw captures and reproduction scripts into `artifacts/` in its work order folder; they are committed with the work order whatever their type, and the reviewer subagent reads them by the paths listed in the receipt. Before, the executor could write only the receipt under `.navigator/`, so a work order that asked for a capture to be saved could not be followed, and evidence ended up outside the repository. Projects initialized with an earlier version should run `init` again to upgrade, so the new ignore rule is written.

### Fixed

- `project-navigator`: after a work order is issued, the orchestrator no longer loops on "工单发布" (work order issued). A new reply type, "等待回执" (awaiting receipt), shows the work order and receipt paths and how to report; choose A once the executor has written the receipt, or B to change the work order. Before, an issued work order without a receipt had no reply type, so choosing "已发工单, 等待回执" (issued, awaiting receipt) brought back the same "工单发布" reply, and resuming or upgrading in that state did the same.
- `project-navigator`: after an upgrade through `init`, the orchestrator follows the next action from `status` instead of always replying with "首次接入" (first entry).

## [0.4.0] - 2026-09-25

### Added

- `project-navigator`: evidence tools for reviews. When a criterion can be confirmed only through an MCP tool, such as a traffic capture for a flow driven by a server-side state machine, you can authorize read-only MCP tools by their full names in "测试授权" (test authorization), and the new `tools set` command registers them for the project. The reviewer subagent loads and calls only registered tools, at the location the executor writes in the receipt's new "取证记录" (evidence record) key; the orchestrator still cannot call any MCP tool.
- `project-navigator`: a user test record, `user-tests.md`, in the work order folder. When you choose to run a test yourself, paste the complete output as a message; the orchestrator writes it unchanged, the hook checks it word for word against your recent messages, and the reviewer subagent judges the criteria from that output.

### Fixed

- `project-navigator`: choosing to run a test yourself in "测试授权" no longer fails the work order by design. The result used to go only into the review record, which the reviewer subagent never saw, so the criterion was always unverified.
- `project-navigator`: during the commit step, denied commands now state the allowed commit forms (`git add -- <paths>`, `git commit -F -` with the message on standard input through heredoc or a PowerShell pipe, and `git push` without force options), and the orchestrator's reminder shows them too. Before, a denied `-m` commit gave a generic reason, and the orchestrator handed the commit to you as if it had no permission.
- `project-navigator`: when changes outside the receipt are found during the commit step, the orchestrator lists them and asks in text instead of excluding them silently.

### Changed

- `project-navigator`: the reviewer subagent no longer lists its tools. It inherits the session's tools so it can reach MCP evidence tools, the guard's allow list decides what it may call, and `disallowedTools` removes the write tools.

## [0.3.1] - 2026-09-24

### Fixed

- `project-navigator`: `init` now keeps the runtime scripts and records committable when project ignore rules such as `lib/`, `bin/`, or `*.json` would leave them out. The `.gitignore` inside `.navigator/` re-includes every directory level and the file types the plugin writes, and still excludes `drafts/`. Before this fix, a Python project's `lib/` rule kept `.navigator/bin/runtime/lib/` out of the repository, so hooks failed after a clone. Projects initialized with an earlier version should run `init` again to upgrade, then commit `.navigator/bin/`.
- `project-navigator`: `init` and every entry check the plugin's files against all of Git's ignore rules, including `.claude/settings.json` and `.claude/rules/engineering.md`. When a rule still ignores a path that must be committed, for example because `.navigator/` itself is ignored, `init` stops before changing anything and entry replies "运行受阻" (blocked), both naming the rule.
- `project-navigator`: `order set committed` refuses while anything under `.navigator/` or in the plugin-managed configuration is left uncommitted, and lists the files for a follow-up commit.

## [0.3.0] - 2026-09-23

### Changed

- `project-navigator`: selection receipts list source evidence in a table (capability, repository, version, path, lines, note), and the new `evidence` command fetches the cited lines from the original repository at that version. The reviewer subagent verifies evidence by running this command, instead of checking only that evidence is present; executors self-check each row with `evidence check`.
- `project-navigator`: a criterion verdict must be 通过 (pass), 不通过 (fail), or 未验证 (unverified). The review record is checked on write, and `order set accepted` and the hands-on acceptance reply refuse while any criterion has not passed.
- `project-navigator`: hands-on acceptance steps may only use commands from the receipt, and the orchestrator no longer asks you to accept unverified criteria on trust.
- `project-navigator`: the check commands chosen during selection must exclude `.navigator/` and `.claude/`.

### Fixed

- `project-navigator`: a rejected selection order now leads to a new selection order. It used to suggest a fix order, which cannot be issued before check commands are registered.
- `project-navigator`: selection receipts gained the "改动清单" (changed files) section that the review prompt and the commit step rely on.
- `project-navigator`: a record file that fails its structure check now reports problems against the structure whose section titles match.

## [0.2.0] - 2026-09-23

### Added

- `project-navigator` skill: guides a large project from a single idea through problem-domain research, framing with Socratic brainstorming, technology selection verified against library source code, a walking skeleton, and vertical slices grouped into milestones, and handles requirement changes along the way. The invoking session only plans, records, issues work orders, and organizes reviews, while separate executor sessions implement. Executors state a module plan before writing code, and every work order that changes code carries a fixed criterion that the project's code checks pass, with function length and complexity rules chosen during selection. Project-level hooks, installed by an explicit `init`, enforce these boundaries, check the fixed reply and record formats, and back up the records to a hidden Git ref for reconciliation after rollbacks or squash merges. Includes a checkup for verbose or unclear records and a bundled set of general engineering standards. Invoke explicitly only; requires Node.js 22 or later.
- Subagents `navigator-reviewer`, `navigator-researcher`, and `navigator-reader`, used only by `project-navigator`.
- Guides for `project-navigator` in Simplified Chinese and English, plus a maintainer guide.

### Fixed

- `commit-message` skill: separate the `A` and `B` options with a blank line, so standard Markdown renderers no longer merge them into one line.

## [0.1.0] - 2026-09-23

### Added

- Plugin scaffold and manifest.
- `commit-message` skill: drafts a Simplified Chinese Conventional Commits message from the actual Git changes without any authorship trailers, asks before including files that Claude did not edit in the session, shows the message, then commits or commits and pushes when you reply `A` or `B`.
- `repo-init` skill: initializes a Git repository with fully commented `.gitignore`, `.editorconfig`, and `.gitattributes` files based on the detected stack, and asks for confirmation of the tracked files.
- Detailed guides for each skill in Simplified Chinese and English, under `docs/`.

[Unreleased]: https://github.com/auYeCoding/radish-plugins/compare/waypoint--v1.0.0...HEAD
[1.0.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v1.0.0
[0.11.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.11.0
[0.10.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.10.0
[0.9.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.9.0
[0.8.1]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.8.1
[0.8.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.8.0
[0.7.5]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.7.5
[0.7.4]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.7.4
[0.7.3]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.7.3
[0.7.2]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.7.2
[0.7.1]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.7.1
[0.7.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.7.0
[0.6.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.6.0
[0.5.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.5.0
[0.4.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.4.0
[0.3.1]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.3.1
[0.3.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.3.0
[0.2.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.2.0
[0.1.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.1.0
