# WayPoint

[English](README.md) | 简体中文

WayPoint 是一个 Claude Code 插件, 提供一组工作流技能.

## 技能列表

| 技能             | 命令                                  | 说明                                                                                                                          |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `commit-message` | `/waypoint:commit-message [额外要求]` | 根据真实的 Git 改动生成符合 [Conventional Commits](https://www.conventionalcommits.org) 的简体中文提交消息, 并按需提交或推送. |
| `repo-init`      | `/waypoint:repo-init`                 | 初始化 Git 仓库, 并按最佳实践编写 `.gitignore`, `.editorconfig` 与 `.gitattributes`.                                          |

两个技能也会在你用自然语言提出相应请求时自动触发.

### commit-message

直接提出需求即可, 例如 "帮我写个提交消息" 或 "write a commit message".

- 消息只依据真实改动生成: 暂存区, 未暂存的改动与未跟踪文件.
- 有暂存内容时, 以暂存内容为准.
- 若本会话中 Claude 改过文件, 而工作区还有其它文件发生了改动, 会先询问是否一起纳入.
- 展示消息后询问如何处理: 回复 `A` 提交, 回复 `B` 提交并推送, 其它回复则不提交. 事先说明 "帮我提交" 或 "提交并推送" 可跳过这一询问.
- 额外要求优先于它自己的判断, 例如 `/waypoint:commit-message fix` 指定 type 为 `fix`.
- 绝不附加 `Co-Authored-By`, `Generated with` 等署名或协作者信息, 提交作者只有你本人.
- 当前目录还不是 Git 仓库时, 会停下并提示你先使用 `/waypoint:repo-init` 初始化仓库.

### repo-init

请求初始化仓库, 或编写 `.gitignore`, `.editorconfig`, `.gitattributes` 时使用.

- 识别项目用到的语言和工具, 以 [github/gitignore](https://github.com/github/gitignore) 官方模板为基础编写 `.gitignore`, 并按 UTF-8, LF 换行, 空格缩进编写 `.editorconfig` 与 `.gitattributes`.
- 三个文件中的每条规则上方都有一行简体中文注释, 注释与规则为一组, 组与组之间空一行.
- 已有同名文件时, 先询问再处理, 不直接覆盖.
- 执行 `git init` 后列出将纳入版本控制的文件, 请你确认. 不暂存, 也不提交.

## 安装

见插件市场 README 中的 [安装](../../README.zh-CN.md#安装) 一节.

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md).

## 许可证

[MIT](../../LICENSE)
