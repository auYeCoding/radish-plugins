# Changelog

All notable changes to the WayPoint plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged as `waypoint--v<version>`.

## [Unreleased]

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

[Unreleased]: https://github.com/auYeCoding/radish-plugins/compare/waypoint--v0.5.0...HEAD
[0.5.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.5.0
[0.4.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.4.0
[0.3.1]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.3.1
[0.3.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.3.0
[0.2.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.2.0
[0.1.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.1.0
