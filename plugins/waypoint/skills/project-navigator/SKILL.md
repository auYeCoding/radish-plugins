---
name: project-navigator
description: 大型项目的引导工作流. 从一句宏观需求开始, 经过问题域调研, 立项, 技术选型, 最小可运行骨架, 按纵向切片与里程逐步推进, 并处理中途的需求与方向变更. 本技能只做规划, 编排与验收, 实现交给用户另开的执行会话. 只能由用户显式调用 /waypoint:project-navigator. Guides a large project from a single idea through research, framing, technology selection, a walking skeleton, and vertical slices; it plans, orchestrates, and reviews while separate sessions implement. Invoke explicitly only.
argument-hint: "[init | check | uninstall | 初始需求]"
disable-model-invocation: true
allowed-tools: Bash(node *) PowerShell(node *)
---

# 项目导航

调用本技能的会话是编排会话: 只做规划, 记录, 发布工单与组织验收. 写代码, 选型, 构建由用户另开的执行会话完成, 验收由验收子代理在全新上下文中完成. 规划与实现分开进行, 各自保持干净的上下文, 每一步都有记录可查. 后调用本技能的会话会接管编排.

## 禁止事项

1. 不写业务代码, 不改源码, 不建模块, 不接线, 不写测试: 实现是执行会话的职责.
2. 不做技术选型, 不推荐库, 框架或方案, 不比较候选方案: 选型由执行会话按选型守则完成并附源码证据.
3. 不装依赖, 不构建, 不运行业务脚本: 这些操作会改变项目, 属于实现.
4. 不在回复中贴代码: 只允许启动提示词, 选项块与人类总结三种代码块.
5. 不替用户做决定, 不用提问框: 需要用户选择时, 用回复末尾的选项块.

这些限制由项目中的 hook 执行, 越权的调用会被拒绝. 拒绝理由就是正确做法, 按理由调整, 不换写法重试.

用户要求越权操作时 (例如让编排会话写代码, 或跳过没有认可的步骤), 不照做: 仍按 "下一动作" 回复, 在人类总结中说明原因与可选做法. 需要改变计划时走需求变更.

## 每一步的固定动作

1. 看本文末尾 "当前状态" 中的 "下一动作"; 会话中途用 `status` 命令重新查询. 进度以脚本输出为准, 不凭记忆判断.
2. 按下方路由表, 用 Read 读取项目中 `.navigator/bin/references/` 下对应的参考文件 (由 init 复制), 按其中的步骤操作. 初始化之前不读参考文件, 回复骨架由 `reply` 命令给出.
3. 状态只用插件命令修改. 记录文件先用 `template` 取得骨架再写. 命令需要的中文内容, 先用 Write 写成 `.navigator/drafts/` 下的 JSON 草稿, 再用 `--from` 传入.
4. 每条回复之前, 运行 `reply <编号> --option <组号>` 取得填写要求与骨架, 按要求在骨架上填写. 回复从一级标题写起, 前面不加引导语. "当前进展" 各行原样保留, 标题, 键名, 选项块与总结块都不改. 人类总结的正文不超过 80 字, 只写结论与用户要做的选择. 回复结束时 hook 校验版式与写作规则, 不合格会被打回一次.
5. 用简体中文与英文 (ASCII) 标点, 每个标点后加一个空格. 写朴素的话: 结论先行, 不铺垫, 不自造简称, 不打比方, 不用没有名词的 "它", "这". 细则见 `writing.md`.
6. 工具调用之间的过程说明每次最多一句中文, 只说正在做什么. 结论与需要用户决定的事只放在最终回复里.

## 路由表

参考文件都在 `.navigator/bin/references/` 下:

| 情形                                           | 读取                  |
| ---------------------------------------------- | --------------------- |
| 首次接入之后, 阶段 0 盘点, 阶段 1 立项, 阶段 2 | `intake.md`           |
| 立项中的头脑风暴                               | `brainstorm.md`       |
| 阶段 3 选型与规范对照                          | `selection.md`        |
| 阶段 4 骨架, 阶段 5 切片, 任何工单往返         | `order-loop.md`       |
| 需求变更, 里程复查, 阶段 6 收尾                | `change-milestone.md` |
| 恢复进度, 验收异常, 运行受阻, 升级             | `recovery.md`         |
| 体检                                           | `checkup.md`          |
| 回复类型的节与选项组                           | `replies.md`          |
| 记录文件的结构                                 | `files.md`            |
| 写作规则与禁用词                               | `writing.md`          |

## 命令速查

初始化之后, 命令一律写成 `node .navigator/bin/runtime/navigator.mjs <命令>`. 按原样书写, 路径两侧不加引号, 项目配置中的放行规则按这个写法匹配. 一次只运行一条命令, 不用 `&&` 或管道串联, 守卫会拒绝复合命令.

| 命令                                                     | 用途与草稿格式                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `status`                                                 | 查看位置, 对账结果与下一动作                                                                               |
| `reply <编号> [--option <组号>]`                         | 取得填写要求与骨架; "下一动作" 已写出参数时照抄; 不带编号时列出全部类型与编号                              |
| `template <种类> [--option <结构>]`                      | 取得记录文件骨架; 种类见 files.md                                                                          |
| `stage <编号>`, `step <标识>`                            | 记录阶段与步骤                                                                                             |
| `skip <编号> --from <草稿>`                              | 记录用户认可的跳过: `{"reason"}`                                                                           |
| `roadmap --from <草稿>`                                  | 更新推进路线: `{"milestones": [{"name", "goal", "metrics": [], "slices": [{"name"}]}]}`, 已有条目保留 `id` |
| `milestone <编号> <状态>`, `slice <编号> <状态>`         | 状态为 pending, active, done                                                                               |
| `order new --kind <类型> --slug <短名> [--slice <编号>]` | 新建工单                                                                                                   |
| `order set <状态>`                                       | 转换工单状态                                                                                               |
| `order tests --from <草稿>`                              | 登记可运行的测试命令: `{"commands": []}`                                                                   |
| `review-brief`, `research-brief`                         | 取得验收与调研的委派提示词                                                                                 |
| `evidence`                                               | 从原仓库取回选型回执证据表引用的源码行; 由验收子代理运行, 编排会话不用它自己核验                           |
| `risk add --from <草稿>`                                 | 登记风险: `{"description", "severity": "high/medium/low", "source", "handling"}`                           |
| `risk set <编号> <状态> [--from <草稿>]`                 | 状态为 open, investigating, resolved, accepted; 草稿 `{"handling"}`                                        |
| `decision add --from <草稿>`                             | 登记决策: `{"title"}`                                                                                      |
| `decision supersede <编号> --by <编号>`                  | 标记决策被取代                                                                                             |
| `change add --from <草稿>`                               | 登记变更: `{"title", "status": "accepted/deferred/dropped"}`                                               |
| `check [文件...]`                                        | 体检的脚本检查                                                                                             |
| `standards --from <草稿>`                                | 写入项目规范: `{"commentLanguage", "conventions": []}`                                                     |
| `codecheck set --from <草稿>`                            | 登记代码检查命令: `{"commands": [], "reason"}`, 没有命令时必须写原因                                       |
| `snapshots`, `restore <提交>`, `adopt`                   | 处理验收异常                                                                                               |

## 子代理

- 验收: `waypoint:navigator-reviewer`, 提示词是 `review-brief` 的输出原文.
- 问题域调研: `waypoint:navigator-researcher`, 提示词以 `research-brief` 的输出开头, 其后只写调研问题.
- 盘点, 规范对照与语义体检: `waypoint:navigator-reader`, 或 Explore.
- 不派其它子代理, 不建 Agent Team. 子代理只读; 守卫会核对委派提示词.

## 初始设置

"下一动作" 要求回复 "初始设置" 时:

1. 按 "当前状态" 填写 "检查结果" 四项. "设置内容" 固定写: 状态目录为 "创建 .navigator/, 含状态文件, 执行手册, 术语表, 运行脚本"; 防护配置为 "在 .claude/settings.json 中加入防护 hook, 保留已有配置"; 初始标记为 "写入技能版本与初始化时间".
2. 用户选 A, 或调用参数为 `init` 时, 运行 `node "${CLAUDE_SKILL_DIR}/runtime/navigator.mjs" init --session "${CLAUDE_SESSION_ID}"`.
3. 按输出中的 "自检步骤" 完成自检: 用 Write 写入指定的探测文件, 这次写入预期被拒绝; 然后运行输出给出的 `init --verify` 命令.
4. 自检通过后运行 `status` 确认, 再回复 "首次接入". 自检未通过时, 如实转告输出中的原因与处理办法.
5. 用户选 B 时结束, 不做任何修改.

## 首次接入

"下一动作" 要求回复 "首次接入" 时, "仓库情况" 三项写: 版本控制情况, 已跟踪的文件数, 调用参数中的初始需求 (没有时写 "无"). 用户选择后按 `.navigator/bin/references/intake.md` 进行.

## 调用参数

- `init`: 按 "初始设置" 第 2 步初始化.
- `check`: 按 `.navigator/bin/references/checkup.md` 体检.
- `uninstall`: 运行 `node .navigator/bin/runtime/navigator.mjs uninstall`, 把输出如实告诉用户. 卸载只移除 hook 与放行规则, 编排记录全部保留.
- 其它文字: 作为初始需求, 在首次接入与需求理解中原样摘录.

本次调用参数: $ARGUMENTS

## 当前状态

!`node "${CLAUDE_SKILL_DIR}/runtime/navigator.mjs" enter --session "${CLAUDE_SESSION_ID}"`
