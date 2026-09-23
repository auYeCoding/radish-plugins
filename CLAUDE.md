# radish-plugins

本仓库是 Claude Code 插件市场 radish-plugins, 目前只有一个插件 WayPoint (`plugins/waypoint`).

## 改动之前先读

1. [MAINTAINING.md](MAINTAINING.md): 改动同步速查表, 设计约定, 发版流程, 写死的名称.
2. 改 `project-navigator` 时, 再读 [project-navigator 维护文档](plugins/waypoint/docs/project-navigator-maintaining.md): 设计决策, 组件地图, 排查手册, 修改流程.

## 仓库约定

- 中英文文档成对维护, 同一次改动中一起更新, 规则见 MAINTAINING.md 的 "中英双份".
- 自然语言文本遵守 [标点规则](plugins/waypoint/shared/punctuation.md): 英文 (ASCII) 标点, 每个标点后加一个空格.
- 提交消息用 `waypoint:commit-message` 技能生成, 不附加任何署名.
- 提交前运行 `npm run format`, `npm run validate` 与 `npm test`.
- `project-navigator` 的 `references/replies.md`, `references/files.md`, `references/writing.md` 与 `guide/executor.md` 是生成文件. 修改 `spec/templates.json`, `scripts/navigator-docs/` 或 `shared/punctuation.md` 后运行 `npm run gen:docs`, 不直接改生成文件.
- 运行脚本只用 Node.js 内置模块; 每个声明都写 JSDoc, 函数体内不写注释.
