# 阶段 3: 选型

本阶段先做规范对照, 再用选型工单回答调研报告中的 "选型问题". 编排会话不推荐方案, 不比较候选方案, 只核对选型回执是否遵守守则并满足简报.

| 步骤标识  | 做什么   | 回复                         |
| --------- | -------- | ---------------------------- |
| standards | 规范对照 | 规范对照                     |
| selection | 选型工单 | 工单发布, 验收报告, 确认提交 |

## 规范对照 (standards)

1. 派 `waypoint:navigator-reader` 对比三处规范, 交回一致, 只有一方有, 互相矛盾三类条目, 每条附文件路径与原文摘录:
   - 插件默认包: `.navigator/bin/standards/engineering.md`
   - 项目已有规范: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, 格式化与检查配置
   - 本机全局规范: `~/.claude/CLAUDE.md`, `~/.claude/rules/`
2. 回复 "规范对照", 按顺序使用三组选项:
   - 有矛盾条目时用第 1 组. "本轮条目" 每轮最多 3 条, 每条写出双方原文与推荐以哪边为准. 用户逐条回答, 或选 B 全部以插件默认包为准.
   - 矛盾处理完后, 对只有一方有的条目用第 2 组, 问是否纳入.
   - 最后用第 3 组问代码注释的语言, 默认中文.
3. 写草稿 `.navigator/drafts/standards.json`: 注释语言写入 `commentLanguage`, 用户选定的项目约定写入 `conventions`, 每条一句. 运行 `standards --from .navigator/drafts/standards.json`, 脚本写入 `.claude/rules/engineering.md`.
4. 用 `decision add` 登记 "项目规范", 并在 `.navigator/plan/decisions.md` 追加对应条目.
5. 运行 `step selection`.

## 选型工单 (selection)

1. 列出选型问题: 调研报告的 "选型问题", 以及主线流程 "外部依赖" 中标注 "待选型" 的条目.
2. 每个选型问题一张工单: `order new --kind selection --slug <短名>`. 工单写明需求中的关键能力, 来自简报与主线流程. 验收判据至少包括:
   - 按项目规范中的技术选型守则逐条说明.
   - 回执 "能力核实" 中每项关键能力附源码证据: 仓库地址, 版本或提交, 文件路径与行号.
   - 选定语言或技术栈的工单, 另加一条: 选定格式化与代码检查工具, 规则中打开函数长度与复杂度检查, 给出能在仓库根目录直接运行的检查命令.
3. 工单往返见 [order-loop.md](order-loop.md). 选型回执使用第 2 种结构 (`template receipt --option 2`).
4. 验收时只核对守则与证据, 不提替代方案. 缺少源码证据的能力判为未验证, 本工单不通过.
5. 验收通过且用户确认后, 用 `decision add` 登记选型结论, 在 `.navigator/plan/decisions.md` 追加条目, 写明决策状态, 批准时间, 来源工单, 决策内容, 决策理由, 可否回退, 影响范围.
6. 选型结论中有检查命令时, 写草稿 `{"commands": ["检查命令"]}`, 运行 `codecheck set --from <草稿>` 登记. 确实没有合适的检查工具时, 经用户同意写 `{"commands": [], "reason": "原因"}` 登记. 登记之前, 实现与修复工单不能发布.
7. 全部选型问题都有决策后, 运行 `stage 4`, 按 [order-loop.md](order-loop.md) 做骨架.
