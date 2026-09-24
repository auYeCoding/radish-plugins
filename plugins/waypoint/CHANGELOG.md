# Changelog

All notable changes to the WayPoint plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged as `waypoint--v<version>`.

## [Unreleased]

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

[Unreleased]: https://github.com/auYeCoding/radish-plugins/compare/waypoint--v0.3.0...HEAD
[0.3.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.3.0
[0.2.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.2.0
[0.1.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.1.0
