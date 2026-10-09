# Changelog

All notable changes to the TracePoint plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged as `tracepoint--v<version>`.

## [Unreleased]

## [0.2.0] - 2026-10-09

### Changed

- `review` skill: `/tracepoint:review` now starts by describing the problems hit in the current session. The agent writes each one out as facts (skill and task, what it saw, which rule it followed, what it did, how the result differs from what you expected) for you to verify, and records it under `.tracepoint/defects/`; when you point out an inaccuracy it corrects both the description and the record. Before, the skill only read records that already existed, so calling it right after a problem showed nothing unless the hook had prompted a record earlier.
- `review-defects.mjs` lists the facts of every record under its pattern, and the skill relays them to you. Before, it printed only a count per pattern, so the records of patterns below the promotion threshold were never shown.

## [0.1.0] - 2026-10-09

### Added

- Plugin scaffold and manifest for `tracepoint`, registered in the marketplace.
- `analyze` skill: reverse-engineering workflow discipline. Opens a per-target case file, gets reverse-engineering tools ready before diving in, forces every conclusion to carry location evidence and a confidence level, routes calculation (offsets, radix, byte/integer conversion) to tools, treats the disassembly as authority over the decompiler, deduplicates against the case file, and sets budgets so analysis does not loop or stop early. Auto-triggers when analyzing a compiled artifact, and is also available as `/tracepoint:analyze`.
- `protected-code` skill: general methodology for protected or obfuscated code. Identifies the protection type (packer, runtime decryption, anti-debugging, self-modifying code, control-flow flattening, opaque predicates, custom VM, decoys) before choosing a static or dynamic path, gives general unpacking / de-virtualization / de-obfuscation approaches, and is honest about what the model can and cannot do. It produces no bypass steps for any specific product.
- `review` skill: user-invoked skill self-iteration. Aggregates fact-only defect records, attributes recurring patterns by a fixed taxonomy, and raises them for the user to decide whether to iterate the skills; it changes no skill on its own.
- Plugin hook: injects the case-file summary at session start and after compaction, a short anchor each turn, and records MCP tool calls into the case file for deduplication; on a correction it prompts the agent to log a defect record. It denies no tool call, is gated on `.tracepoint/` (fully silent otherwise), and injects nothing inside subagents.
- Case file at `.tracepoint/case.json` with atomic writes, plus a defect inbox at `.tracepoint/defects/`.
- Tools: `discover-mcp.mjs` (discovers reverse-engineering MCP servers from the configuration, not just `PATH`), `check-case.mjs` (verifies every conclusion carries location evidence; zero conclusions fails), and `review-defects.mjs` (aggregates defect records and lists patterns that reach the promotion threshold).
- Generic self-iteration library (`runtime/lib/self-iteration.mjs`), vendored per plugin and kept identical to WayPoint's copy so each plugin installs standalone.
- Unit and coexistence tests under `tests/tracepoint/`.
- Guides in Simplified Chinese and English.

[Unreleased]: https://github.com/auYeCoding/radish-plugins/compare/tracepoint--v0.2.0...HEAD
[0.2.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/tracepoint--v0.2.0
[0.1.0]: https://github.com/auYeCoding/radish-plugins/releases/tag/tracepoint--v0.1.0
