# TracePoint

English | [简体中文](README.md)

[![TracePoint version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FauYeCoding%2Fradish-plugins%2Fmain%2Fplugins%2Ftracepoint%2F.claude-plugin%2Fplugin.json&query=%24.version&label=tracepoint)](CHANGELOG.md)

TracePoint is a [Claude Code](https://code.claude.com) plugin that brings workflow and discipline to reverse engineering. It keeps a case file for each target, forces every conclusion to carry location evidence, routes calculation to tools, treats the disassembly as authority, and sets budgets so analysis does not loop or stop early. It adds a chapter of general methods for protected code, and a skill self-iteration loop that the user controls. Skill text, case files, and defect records are written in Simplified Chinese.

The focus is process, not a catalogue of tricks. TracePoint does not teach how to recognize a given algorithm, and it does not write bypass steps for any specific product; it constrains how to analyze without erring, repeating work, or making things up halfway.

## Prerequisites

- [Node.js](https://nodejs.org) 22 or later (the hook and scripts use only built-in modules).
- Reverse-engineering tools and their MCP servers, as needed: disassemblers/decompilers (IDA/idalib, Ghidra, radare2, DHS), debuggers (x64dbg, DHS, Cheat Engine), mobile (jadx, Jeb, Frida, `adb`). These MCP servers connect only once the corresponding software is open; `discover-mcp` lists which are configured and which are not yet connected.
- The target directory need not be a Git repository.

## What it provides

| Part                                          | Trigger                                                                                         | Role                                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`analyze`](docs/analyze.en.md)               | auto-triggers when analyzing a compiled artifact, or `/tracepoint:analyze`                      | Reverse-engineering workflow discipline: open a case file, get tools ready, back conclusions with evidence, route calculation to tools, treat the disassembly as authority, deduplicate, and budget. |
| [`protected-code`](docs/protected-code.en.md) | auto-triggers on protection (packer/VM/obfuscation/anti-debug), or `/tracepoint:protected-code` | General methods for protected code: identify the protection type first, then choose static or dynamic; honest about what the model can and cannot do.                                                |
| [`review`](docs/review.en.md)                 | `/tracepoint:review` only                                                                       | Reviews recorded skill defects, attributes them by a fixed taxonomy, and raises recurring ones for the user to decide whether to iterate the skills; **never changes skills on its own**.            |
| Plugin hook                                   | session start / each turn / after an MCP call (automatic)                                       | Injects case-file context and records progress only; **denies no tool call**. Gated on `.tracepoint/`: fully silent when no case file exists.                                                        |
| Case file                                     | created by `analyze` at the start                                                               | `.tracepoint/case.json` inside the target directory: functions already analyzed, evidence-backed conclusions, protection type, to-dos, and methods already tried.                                    |

Scripts (`runtime/tools/`): `discover-mcp.mjs` discovers the reverse-engineering MCP servers in your configuration and prompts you to open the software first; `check-case.mjs` checks that every conclusion carries location evidence (zero conclusions is a failure); `review-defects.mjs` aggregates defect records and lists the patterns that reach the promotion threshold.

## Quick start

1. Open a session in the target's directory and tell Claude "reverse-engineer this program" (or run `/tracepoint:analyze` directly). It creates `.tracepoint/case.json` as the case file and runs `discover-mcp` to check that the reverse-engineering tools are ready.
2. Once the case file exists, the hook injects it at session start, after compaction, and on each turn, and records MCP tool calls into the case file for deduplication. Read the case file before you act, and do not redo analysis already done.
3. On a packer, VM, or obfuscation, Claude uses the `protected-code` methods to identify the protection type before choosing an analysis path.
4. When analysis reaches a resting point, run `check-case` to verify that every conclusion carries location evidence.

The case file is not tracked by default: ignore `.tracepoint/` in the target directory's `.gitignore`.

## Skill self-iteration

When you correct TracePoint, it prompts the agent to append a fact-only defect record to `.tracepoint/defects/` (what it saw, which rule applied, what it did, how it turned out), without letting the agent decide "rule's fault or mine". You then run `/tracepoint:review` to aggregate: recurring patterns (across tasks, recent) are attributed by a fixed taxonomy with suggested changes, and **whether to change a skill is your call**. This logic (`runtime/lib/self-iteration.mjs`) is generic and can be reused by other plugins in the same bundle, each handling its own namespace without double-recording.

## Coexistence with other plugins

TracePoint is designed to coexist, in one project, with other plugins in the bundle (such as WayPoint's `project-navigator`) and with the user's global hooks:

- It occupies only one dot-directory, `.tracepoint/`, inside the target directory; it writes nothing under `.claude/` and takes none of another plugin's locations.
- The hook injects and records only; it denies no tool call and dictates no reply structure. With no `.tracepoint/` it is fully silent, and it injects nothing inside subagents.
- While a target is paused in a debugger, the hook records debugger calls without denying them.
- Each plugin's self-iteration handles only the skills in its own namespace.

## Installation

See the [Installation](../../README.en.md#installation) section of the marketplace README.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](../../LICENSE)
