# Changelog

All notable changes to the WayPoint plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged as `waypoint--v<version>`.

## [Unreleased]

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

[Unreleased]: https://github.com/auYeCoding/radish-plugins/compare/waypoint--v0.1.0...HEAD
[0.1.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/waypoint--v0.1.0
