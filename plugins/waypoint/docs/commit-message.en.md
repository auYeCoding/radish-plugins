# commit-message

English | [简体中文](commit-message.md)

[Back to WayPoint](../README.en.md)

Drafts a Simplified Chinese [Conventional Commits](https://www.conventionalcommits.org) message from the actual changes in the current Git repository (staged changes, unstaged changes, and untracked files), then commits, or commits and pushes, as you intend.

## When to use it

- You finished a change and need a well-formed commit message that matches it.
- You want Claude to commit or push its work once a task is done.

The skill is not used to explain or review existing commits, rewrite past commit messages (amend, reword), write pull request descriptions or changelogs, browse Git history, or run other Git operations such as rebase, merge, or cherry-pick.

## How to trigger it

**Plain language.** Just ask, for example:

- "write a commit message", "帮我写个提交消息"
- "commit it", "帮我提交"
- "commit and push", "提交并推送"

**Slash command.** `/waypoint:commit-message [extra request]`. The extra request overrides the skill's own judgment, for example:

- `/waypoint:commit-message fix`: forces the `fix` type.
- `/waypoint:commit-message emphasize the performance improvement`: highlights the performance work in the message.

## Workflow

1. **Check the repository state.**
   - Not a Git repository: asks you to run [`/waypoint:repo-init`](repo-init.en.md) first, then stops.
   - Conflicts, or a rebase in progress: asks you to resolve them first and writes no message.
   - A merge or cherry-pick in progress: Git has already prepared a default message, so the skill writes none.
   - A revert in progress (`git revert --no-commit`): writes a `revert` message as usual.
2. **List the changes**, including untracked files. With no changes at all, it replies that there is nothing to commit.
3. **Decide what to include**, as described in the next section.
4. **Read the changes and write the message.** For large changes it reads the summary first; lock files, generated files, and binary files are summarized from their statistics only.
5. **Show the message and decide what happens next.** If you stated your intent up front, it acts on it; otherwise it shows the message and asks you to choose A or B.
6. **Commit or push**, then report the short commit hash and the remote branch it pushed to.

## What gets included

| Situation                                                     | Behavior                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Claude edited files in this session, and other files changed  | Asks first whether to include the other files: all of them, only this session's, or a subset |
| Claude edited files in this session, and nothing else changed | Includes those files                                                                         |
| Claude edited no files, and some changes are staged           | Includes only the staged changes, treating them as your selection                            |
| Claude edited no files, and nothing is staged                 | Includes every change, untracked files included                                              |

This question comes before the message is written, whether you asked to "write a commit message", "commit", or "commit and push".

## Message format

```
type(scope): 主题

- 要点一
- 要点二

整体描述
```

- **type** is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **scope** is optional. It is added when the change clearly belongs to one area, following the scopes already used in the repository's history.
- **Subject** summarizes the change in one line, with no trailing punctuation.
- **Bullet points** list the concrete changes, each traceable to the actual diff.
- **Closing sentence** states the intent or impact in one sentence without repeating the bullets. When the motive is not evident, it describes the impact instead of guessing.
- **Breaking changes** add `!` after the type or scope, such as `feat(api)!: 移除旧版登录接口`, and the closing sentence spells out the impact.
- **Punctuation** uses ASCII punctuation followed by a space. See [punctuation.md](../shared/punctuation.md) for the full rules.
- **No authorship.** The skill never adds `Co-Authored-By`, `Generated with`, or any other authorship or co-author information, even when asked to.

## Examples

### Asking for a message only

When you say "write a commit message", the reply looks like this. Reply `A` to commit or `B` to commit and push; any other reply leaves the changes uncommitted:

````text
```
feat(parser): 支持多行注释

- 在词法分析中识别 /* */ 多行注释
- 为多行注释补充单元测试

避免多行注释被误判为语法错误.
```

---

[如何处理?]

A. 提交

B. 提交并推送
````

### Stating your intent up front

When you say "commit and push", the skill shows the message and acts without asking, then reports the result, for example that it committed `a1b2c3d` and pushed to `origin/feat/parser`.

### Other files changed too

Claude edited `src/parser.js` in this session, and you edited `README.md` yourself. Before writing the message, Claude lists `README.md` and asks whether to include it.

### Not a Git repository

The reply asks you to run `/waypoint:repo-init` first. The skill never runs `git init` itself.

## Safety when committing and pushing

- Stages files by explicit path, never with `git add -A` or `git add .`.
- Warns and asks before including files that look like secrets or credentials, such as `.env`, `*.pem`, or `*.key`.
- Never uses `--no-verify`, `--amend`, `--trailer`, or `--signoff` unless you explicitly ask. Authorship trailers are never added.
- Stops and reports the output when a Git hook fails, without bypassing or retrying it.
- Checks after committing that the recorded message matches the one it showed.
- When pushing:
  - The branch has an upstream: pushes to it.
  - No upstream and a single remote: pushes and sets the upstream.
  - Several remotes: asks you which one to push to.
  - Never force-pushes. If the push is rejected, it reports the reason.

## FAQ

**Why didn't my request trigger this skill?**

Another skill that writes commit messages is probably installed, and Claude picked that one. Disable the other skill, or call `/waypoint:commit-message` directly.

**Why are my unstaged changes missing from the message?**

When Claude edited no files in the session and you staged some changes, the skill treats the staged changes as your selection and writes the message for them only.

**Can it write English commit messages?**

No. The skill always writes Simplified Chinese messages.

**I want an authorship trailer in my commit. What can I do?**

The skill never adds one. Edit the commit yourself afterwards, for example with `git commit --amend`.

## Known limitations

- Commit messages are always written in Simplified Chinese.
- No message is written while a merge or cherry-pick is in progress. Use the default message Git prepares.
