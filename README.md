![radish-plugins: 实用的 Claude Code 插件](.github/assets/social-preview.png)

[English](README.en.md) | 简体中文

[![Validate](https://github.com/auYeCoding/radish-plugins/actions/workflows/validate.yml/badge.svg)](https://github.com/auYeCoding/radish-plugins/actions/workflows/validate.yml)
[![WayPoint version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FauYeCoding%2Fradish-plugins%2Fmain%2Fplugins%2Fwaypoint%2F.claude-plugin%2Fplugin.json&query=%24.version&label=waypoint)](plugins/waypoint/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**radish-plugins** 是一个 [Claude Code](https://code.claude.com) 实用插件市场, 帮你处理日常开发中的琐事. 由 auYeCoding 维护, 会陆续加入新的插件和技能.

## 插件列表

| 插件                                      | 技能                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 文档                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| [WayPoint](plugins/waypoint) (`waypoint`) | [`commit-message`](plugins/waypoint/docs/commit-message.md): 根据真实的 Git 改动生成符合 Conventional Commits 的简体中文提交消息, 并按需提交或推送.<br>[`repo-init`](plugins/waypoint/docs/repo-init.md): 初始化 Git 仓库, 编写逐条附中文注释的 `.gitignore`, `.editorconfig` 与 `.gitattributes`.<br>[`project-navigator`](plugins/waypoint/docs/project-navigator.md): 引导大型项目从一句需求走到立项, 选型, 骨架与逐个切片的交付, 只做规划与验收, 实现交给另开的会话. | [插件说明](plugins/waypoint/README.md) |

点击技能名可查看该技能的详细介绍与使用方法. WayPoint 生成的提交消息, 规则文件注释与项目记录都使用简体中文.

## 使用前提

- [Claude Code](https://code.claude.com)
- [Git](https://git-scm.com)
- `project-navigator` 需要 [Node.js](https://nodejs.org) 22 或更高版本.
- 可选: [GitHub CLI](https://cli.github.com) (`gh`). `repo-init` 用它获取 `.gitignore` 模板, 没有安装时改为直接下载.

## 安装

在 Claude Code 中执行:

```text
/plugin marketplace add auYeCoding/radish-plugins
/plugin install waypoint@radish-plugins
```

或在终端中执行:

```bash
claude plugin marketplace add auYeCoding/radish-plugins
claude plugin install waypoint@radish-plugins
```

## 更新

每个插件都固定了版本号, 只有发布新版本时才会收到更新. 在终端中执行:

```bash
claude plugin marketplace update radish-plugins
claude plugin update waypoint@radish-plugins
```

重启 Claude Code 后更新生效. 各版本的变更见对应插件目录下的 `CHANGELOG.md`.

## 卸载

```bash
claude plugin uninstall waypoint@radish-plugins
claude plugin marketplace remove radish-plugins
```

## 获取帮助

- **使用提问与想法交流:** [GitHub Discussions](https://github.com/auYeCoding/radish-plugins/discussions)
- **Bug 与功能请求:** [issues](https://github.com/auYeCoding/radish-plugins/issues/new/choose)
- **安全漏洞:** 请按 [SECURITY.md](SECURITY.md) 私下报告, 切勿提交公开 issue.

## 参与贡献

欢迎提交 issue 和 pull request. 请先阅读 [贡献指南](CONTRIBUTING.md) (英文) 和 [行为准则](CODE_OF_CONDUCT.md).

## 许可证

[MIT](LICENSE)

## 免责声明

本项目是独立的社区项目, 与 Anthropic 无关联, 也未获得 Anthropic 的认可或赞助. "Claude" 与 "Claude Code" 是 Anthropic, PBC 的商标.
