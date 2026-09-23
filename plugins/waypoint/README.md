# WayPoint

[English](README.en.md) | 简体中文

[![WayPoint version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FauYeCoding%2Fradish-plugins%2Fmain%2Fplugins%2Fwaypoint%2F.claude-plugin%2Fplugin.json&query=%24.version&label=waypoint)](CHANGELOG.md)

WayPoint 是一个提供实用工作流技能的 [Claude Code](https://code.claude.com) 插件. 目前涵盖仓库初始化与提交消息生成, 之后会陆续加入更多技能. 技能生成的提交消息与规则文件注释都使用简体中文.

## 使用前提

- [Git](https://git-scm.com)
- 可选: [GitHub CLI](https://cli.github.com) (`gh`). `repo-init` 用它获取 `.gitignore` 模板, 没有安装时改为直接下载.

## 技能列表

| 技能             | 命令                                  | 用途                                                                                     | 文档                               |
| ---------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `commit-message` | `/waypoint:commit-message [额外要求]` | 根据真实的 Git 改动生成符合 Conventional Commits 的简体中文提交消息, 并按需提交或推送.   | [使用说明](docs/commit-message.md) |
| `repo-init`      | `/waypoint:repo-init`                 | 初始化 Git 仓库, 编写逐条附中文注释的 `.gitignore`, `.editorconfig` 与 `.gitattributes`. | [使用说明](docs/repo-init.md)      |

两个技能都会在你用自然语言提出相应请求时自动触发, 也可以用上表中的斜杠命令直接调用.

## 快速上手

以一个还没有纳入版本控制的新项目为例:

1. 在项目目录中对 Claude 说 "帮我初始化这个仓库". `repo-init` 会编写三个规则文件, 执行 `git init`, 然后列出将纳入版本控制的文件请你确认.
2. 确认后说 "帮我写个提交消息". `commit-message` 会展示根据改动生成的提交消息, 你回复 `A` 提交, 或回复 `B` 提交并推送.

之后每次改完代码, 重复第 2 步即可.

## 使用提示

- 请停用其它生成提交消息的技能, 例如 `~/.claude/skills` 中的个人技能. 否则请求提交消息时, Claude 可能在两者之间任选其一.

## 安装

见插件市场 README 中的 [安装](../../README.md#安装) 一节.

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md).

## 许可证

[MIT](../../LICENSE)
