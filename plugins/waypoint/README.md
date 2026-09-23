# WayPoint

English | [简体中文](README.zh-CN.md)

WayPoint is a Claude Code plugin that bundles workflow skills.

## Skills

| Skill            | Command                                    | Description                                                                                                                                                     |
| ---------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit-message` | `/waypoint:commit-message [extra request]` | Drafts a Simplified Chinese [Conventional Commits](https://www.conventionalcommits.org) message from the actual Git changes, then commits or pushes on request. |
| `repo-init`      | `/waypoint:repo-init`                      | Initializes a Git repository with best-practice `.gitignore`, `.editorconfig`, and `.gitattributes` files.                                                      |

Both skills also trigger automatically when you ask for them in plain language.

### commit-message

Ask for a commit message, for example "write a commit message" or "帮我写个提交消息".

- The message is built only from the actual changes: staged, unstaged, and untracked files.
- Staged changes are used as-is when present.
- If Claude edited files in the current session and other files have also changed, it first asks whether to include those other files.
- After showing the message, it asks how to proceed: reply `A` to commit or `B` to commit and push. Any other reply leaves the changes uncommitted. Say "commit it" or "commit and push" up front to skip the question.
- Extra requests override its own judgment, for example `/waypoint:commit-message fix` forces the `fix` type.
- It never adds authorship or co-author information such as `Co-Authored-By` or `Generated with`. You are the only author of your commits.
- In a directory that is not a Git repository yet, it stops and asks you to run `/waypoint:repo-init` first.

### repo-init

Ask to initialize a repository or to write `.gitignore`, `.editorconfig`, or `.gitattributes`.

- It detects the project's languages and tools, builds `.gitignore` from the official [github/gitignore](https://github.com/github/gitignore) templates, and writes `.editorconfig` and `.gitattributes` with UTF-8, LF line endings, and space indentation.
- Every rule in the three files has its own Simplified Chinese comment on the line above it, and each comment-and-rule pair is separated by a blank line.
- It never overwrites existing files without asking.
- After `git init`, it lists the files that will be tracked and asks you to confirm. It never stages or commits.

## Installation

See [Installation](../../README.md#installation) in the marketplace README.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](../../LICENSE)
