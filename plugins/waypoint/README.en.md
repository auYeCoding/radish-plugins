# WayPoint

English | [简体中文](README.md)

[![WayPoint version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FauYeCoding%2Fradish-plugins%2Fmain%2Fplugins%2Fwaypoint%2F.claude-plugin%2Fplugin.json&query=%24.version&label=waypoint)](CHANGELOG.md)

WayPoint is a [Claude Code](https://code.claude.com) plugin of practical workflow skills. It currently covers setting up a repository, writing commit messages, and guiding large projects, and more skills will be added over time. Commit messages, rule-file comments, and project records produced by its skills are written in Simplified Chinese.

## Requirements

- [Git](https://git-scm.com)
- `project-navigator` needs [Node.js](https://nodejs.org) 22 or later.
- Optional: [GitHub CLI](https://cli.github.com) (`gh`). `repo-init` uses it to fetch `.gitignore` templates and downloads them directly when it is not installed.

## Skills

| Skill               | Command                                    | Purpose                                                                                                                                                                                 | Docs                                                                                                |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `commit-message`    | `/waypoint:commit-message [extra request]` | Drafts a Simplified Chinese Conventional Commits message from the actual Git changes, then commits or pushes on request.                                                                | [Guide](docs/commit-message.en.md)                                                                  |
| `repo-init`         | `/waypoint:repo-init`                      | Initializes a Git repository with fully commented `.gitignore`, `.editorconfig`, and `.gitattributes` files.                                                                            | [Guide](docs/repo-init.en.md)                                                                       |
| `project-navigator` | `/waypoint:project-navigator [argument]`   | Guides a large project from a single idea through framing, technology selection, a skeleton, and slice-by-slice delivery; it only plans and reviews, while separate sessions implement. | [Guide](docs/project-navigator.en.md), [maintainer guide](docs/project-navigator-maintaining.en.md) |

`commit-message` and `repo-init` trigger automatically when you ask for them in plain language, and you can also call them directly with the slash commands above. `project-navigator` runs only when invoked explicitly with its slash command.

## Quick start

Take a new project that is not under version control yet:

1. In the project directory, ask Claude to "initialize this repository". `repo-init` writes the three rule files, runs `git init`, and lists the files that will be tracked for you to confirm.
2. After confirming, ask for "a commit message". `commit-message` shows a message built from your changes. Reply `A` to commit, or `B` to commit and push.

From then on, repeat step 2 whenever you finish a change.

To drive a larger project from scratch, run `/waypoint:project-navigator <your requirement>` after step 1, and move forward with the options at the end of each reply. See [Quick start](docs/project-navigator.en.md#quick-start) for a full walkthrough.

## Tips

- Disable any other skill that writes commit messages, such as a personal skill in `~/.claude/skills`. Otherwise Claude may pick either skill when you ask for a commit message.
- Once `project-navigator` is initialized in a project, its guard hooks apply to every session in that project. For example, ordinary sessions cannot edit the records under `.navigator/`. Run `/waypoint:project-navigator uninstall` when you no longer need it.

## Installation

See [Installation](../../README.en.md#installation) in the marketplace README.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](../../LICENSE)
