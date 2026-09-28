# Changelog

All notable changes to the WayPoint plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged as `waypoint--v<version>`.

## [Unreleased]

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

[Unreleased]: https://github.com/auYeCoding/radish-plugins/compare/waypoint--v0.7.4...HEAD
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
