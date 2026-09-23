# radish-plugins

[English](README.md) | 简体中文

[![Validate](https://github.com/auYeCoding/radish-plugins/actions/workflows/validate.yml/badge.svg)](https://github.com/auYeCoding/radish-plugins/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

由 auYeCoding 维护的 [Claude Code](https://code.claude.com) 插件市场.

## 插件列表

| 插件                                      | 说明                      | 文档                                       |
| ----------------------------------------- | ------------------------- | ------------------------------------------ |
| [WayPoint](plugins/waypoint) (`waypoint`) | Claude Code 工作流技能集. | [README](plugins/waypoint/README.zh-CN.md) |

## 安装

在 Claude Code 中执行以下命令.

1. 添加插件市场:

   ```text
   /plugin marketplace add auYeCoding/radish-plugins
   ```

2. 安装插件:

   ```text
   /plugin install waypoint@radish-plugins
   ```

## 更新

每个插件都固定了版本号, 只有发布新版本时才会收到更新. 在终端中执行:

```bash
claude plugin marketplace update radish-plugins
claude plugin update waypoint@radish-plugins
```

重启 Claude Code 后更新生效. 各版本的变更见对应插件目录下的 `CHANGELOG.md`.

## 参与贡献

欢迎提交 issue 和 pull request. 请先阅读 [贡献指南](CONTRIBUTING.md) (英文) 和 [行为准则](CODE_OF_CONDUCT.md).

## 安全问题

请勿在公开 issue 中报告安全漏洞, 报告方式见 [SECURITY.md](SECURITY.md).

## 许可证

[MIT](LICENSE)

## 免责声明

本项目是独立的社区项目, 与 Anthropic 无关联, 也未获得 Anthropic 的认可或赞助. "Claude" 与 "Claude Code" 是 Anthropic, PBC 的商标.
