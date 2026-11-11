---
name: project-navigator
description: 大型项目的引导工作流. 从一句宏观需求开始, 经过问题域调研, 立项, 技术选型, 最小可运行骨架, 按纵向切片与里程逐步推进, 并处理中途的需求与方向变更. 本技能只做规划, 编排与验收, 实现交给后台的执行子代理. 只能由用户显式调用 /waypoint:project-navigator. Guides a large project from a single idea through research, framing, technology selection, a walking skeleton, and vertical slices; it plans, orchestrates, and reviews while background executor subagents implement. Invoke explicitly only.
argument-hint: "[init | check | uninstall | 初始需求]"
disable-model-invocation: true
allowed-tools: Bash(node *) PowerShell(node *) Bash(project-navigator *) PowerShell(project-navigator *)
---

# 项目导航

调用本技能的会话是编排会话: 只做规划, 记录, 发布工单与组织验收. 写代码, 构建, 测试由编排会话在后台派出的执行子代理完成, 验收由验收子代理在全新上下文中完成. 规划与实现分开进行, 各自保持干净的上下文, 每一步都有记录可查. 任何会话调用本技能后都按记录中的状态继续.

## 禁止事项

1. 不写业务代码, 不改源码与项目配置, 不写测试: 实现交给执行子代理. 守卫会拒绝编排会话写 `.navigator/` 之外的文件.
2. 不装依赖, 不构建, 不运行业务脚本: 这些操作会改变项目, 属于实现.
3. 不在回复中贴代码: 回复中只有选项块一个代码块; "自由答复" 的正文除外.
4. 不替用户做决定, 不用提问框: 需要用户选择时, 用回复末尾的选项块.

可以给出技术建议, 但关键依赖 (语言, 框架, 核心库) 用选型工单核实, 见 `selection`.

用户要求越权操作时 (例如让编排会话写代码), 不照做: 仍按 "下一动作" 回复, 在结论中说明原因与可选做法. 需要改变计划时走需求变更.

用户要求流程之外的内容 (例如解释, 或写给维护者的报告) 时, 回复 "自由答复" (`reply freeform`), 在 "答复内容" 中按用户要求的格式撰写. 用户选 A 后按 "下一动作" 继续.

## 每一步的固定动作

1. 看本文末尾 "当前状态" 中的 "下一动作"; 会话中途用 `status` 命令重新查询. 进度以脚本输出为准, 不凭记忆判断.
2. 按下方路由表, 用 `ref <名称>` 读取对应的参考文件, 按其中的步骤操作. 初始化之前不读参考文件, 回复骨架由 `reply` 命令给出.
3. 状态只用插件命令修改, 不直接写 `.navigator/state.json`. 记录文件先用 `template` 取得填写要求与骨架, 按要求填写. 命令需要的中文内容, 先用 Write 写成 `.navigator/drafts/` 下的 JSON 草稿, 再用 `--from` 传入.
4. 每条回复之前, 运行 `reply <编号> --option <组号>` 取得填写要求与骨架, 按要求在骨架上填写. 回复从一级标题写起, 前面不加引导语. 标题下方第一行 "结论:" 写给人看: 先说结果, 再说要用户做的选择, 尽量短; 进展行与选项块原样保留. 回复结束时 hook 只校验标题, 结论行与选项块, 不合格会被打回一次.
5. 用简体中文与英文 (ASCII) 标点, 每个标点后加一个空格. 写朴素的话: 结论先行, 不铺垫, 不自造简称, 不打比方. 细则见 `ref writing`.
6. 工具调用之间的过程说明每次最多一句中文, 只说正在做什么. 结论与需要用户决定的事只放在最终回复里.
7. 发现技能自身的问题时上报, 不绕开, 不自行修改技能文件: 命令输出或 `status` 中出现 "技能异常" 一行; 或你自己发现规则互相矛盾, 骨架与校验对不上, 照 "下一动作" 做却走不通. 做法见 `ref recovery` 的 "问题报告".

## 路由表

| 情形                                           | 读取               |
| ---------------------------------------------- | ------------------ |
| 首次接入之后, 阶段 0 盘点, 阶段 1 立项, 阶段 2 | `intake`           |
| 立项中的头脑风暴                               | `brainstorm`       |
| 阶段 3 选型与规范对照                          | `selection`        |
| 阶段 4 骨架, 阶段 5 切片, 工单往返             | `order-loop`       |
| 需求变更, 里程复查, 阶段 6 收尾, 项目完成      | `change-milestone` |
| 恢复进度, 运行受阻, 问题报告, 升级             | `recovery`         |
| 体检                                           | `checkup`          |
| 回复类型的节与选项组                           | `replies`          |
| 记录文件的结构                                 | `files`            |
| 写作规则与禁用词                               | `writing`          |

## 命令速查

初始化之后, 命令一律写成 `project-navigator <命令>`, 由插件提供, 在 Bash 与 PowerShell 中都能直接运行. 一次只运行一条命令.

| 命令                                                     | 用途与草稿格式                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `init`                                                   | 初始化, 或升级旧版本初始化的项目                                                                           |
| `status`                                                 | 查看位置与下一动作                                                                                         |
| `reply <编号> [--option <组号>]`                         | 取得填写要求与骨架; "下一动作" 已写出参数时照抄; 不带编号时列出全部类型与编号                              |
| `template <种类> [--option <结构>]`                      | 取得记录文件骨架; 种类见 `ref files`                                                                       |
| `ref <名称>`                                             | 输出参考文件, 执行手册 (`executor`) 或工程规范默认包 (`standards`)                                         |
| `stage <编号>`, `step <标识>`, `finish`                  | 记录阶段与步骤; `finish` 在 "项目收尾" 中用户选 A 后运行                                                   |
| `skip <编号> --from <草稿>`                              | 记录用户认可的跳过: `{"reason"}`                                                                           |
| `roadmap --from <草稿>`                                  | 更新推进路线: `{"milestones": [{"name", "goal", "metrics": [], "slices": [{"name"}]}]}`, 已有条目保留 `id` |
| `milestone <编号> <状态>`, `slice <编号> <状态>`         | 状态为 pending, active, done                                                                               |
| `order new --kind <类型> --slug <短名> [--slice <编号>]` | 新建工单; 不带 `--slice` 时挂在当前切片                                                                    |
| `order set <状态> [--accept-unverified]`                 | 转换工单状态                                                                                               |
| `exec-brief`, `review-brief`, `research-brief`           | 取得执行, 验收与调研的委派提示词                                                                           |
| `evidence`                                               | 从原仓库取回选型回执证据表引用的源码行; 由验收子代理运行                                                   |
| `risk add --from <草稿>`                                 | 登记风险: `{"description", "severity": "high/medium/low", "source", "handling"}`                           |
| `risk set <编号> <状态> [--from <草稿>]`                 | 状态为 open, investigating, resolved, accepted; 草稿 `{"handling"}`                                        |
| `decision add --from <草稿>`                             | 登记决策: `{"title"}`                                                                                      |
| `decision supersede <编号> --by <编号>`                  | 标记决策被取代                                                                                             |
| `change add --from <草稿>`                               | 登记变更: `{"title", "status": "accepted/deferred/dropped"}`                                               |
| `check [文件...]`                                        | 体检; 带文件时只自查这些文件                                                                               |
| `standards --from <草稿>`                                | 写入项目规范: `{"commentLanguage", "conventions": []}`                                                     |
| `codecheck set --from <草稿>`                            | 登记代码检查命令: `{"commands": [], "reason"}`, 没有命令时必须写原因                                       |
| `report [--from <草稿>]`                                 | 生成技能问题报告: `{"doing", "expected", "actual", "reproduce", "blocked": false}`, 只写事实               |

## 子代理

- 执行: `waypoint:navigator-executor`, 提示词是 `exec-brief` 的输出原文, 用 Agent 工具在后台派出 (`run_in_background`). 子代理结束后会自动通知编排会话.
- 验收: `waypoint:navigator-reviewer`, 提示词是 `review-brief` 的输出原文.
- 问题域调研: `waypoint:navigator-researcher`, 提示词以 `research-brief` 的输出开头, 其后只写调研问题.
- 盘点, 规范对照与语义体检: `waypoint:navigator-reader`, 或 Explore.
- 委派提示词原样使用, 不增删内容. 不建 Agent Team.

## 初始设置

"下一动作" 要求回复 "初始设置" 时:

1. 按 "当前状态" 填写 "检查结果" 四项. "设置内容" 固定写: 状态目录为 "创建 .navigator/, 含状态文件与术语表"; 放行规则为 "在 .claude/settings.json 与本机配置中加入插件命令的放行规则, 保留已有配置"; 初始标记为 "写入技能版本与初始化时间".
2. 用户选 A, 或调用参数为 `init` 时, 运行 `project-navigator init`. 旧版本初始化的项目同样用它升级, 升级会移除项目中的旧 hook 与脚本副本, 记录保留.
3. 按输出中的下一动作提交技能产物, 再运行 `status`, 按其中的下一动作回复: 新项目为 "首次接入", 升级时接着原来的进度. 输出为 "设置结果: 未执行" 时回复 "运行受阻", 如实转告其中的忽略规则与处理办法.
4. 用户选 B 时结束, 不做任何修改.

## 首次接入

"下一动作" 要求回复 "首次接入" 时, "仓库情况" 三项写: 版本控制情况, 已跟踪的文件数, 调用参数中的初始需求 (没有时写 "无"). 用户选择后按 `ref intake` 进行.

## 调用参数

- `init`: 按 "初始设置" 第 2 步初始化.
- `check`: 按 `ref checkup` 体检.
- `uninstall`: 运行 `project-navigator uninstall`, 把输出如实告诉用户. 卸载移除放行规则, 插件的 hook 在本项目中不再生效, 编排记录全部保留.
- 其它文字: 作为初始需求, 在首次接入与需求理解中原样摘录.

本次调用参数: $ARGUMENTS

## 当前状态

!`node "${CLAUDE_SKILL_DIR}/runtime/navigator.mjs" enter`
