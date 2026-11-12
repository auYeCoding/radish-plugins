---
name: project-navigator
description: 大型项目的引导工作流. 从一句宏观需求开始, 确认需求, 排出按里程与纵向切片推进的路线, 先做最小可运行骨架, 再一个切片一个切片地丰满, 并记住进度, 任何会话都能接着做. 本技能只做规划, 编排与验收, 实现交给后台的实现子代理, 验收交给独立的验收子代理. 只能由用户显式调用 /waypoint:project-navigator. Guides a large project from a single idea to a roadmap of milestones and vertical slices, walking skeleton first; it plans, orchestrates, and reviews while subagents implement and verify. Invoke explicitly only.
argument-hint: "[init | check | uninstall | 初始需求]"
disable-model-invocation: true
allowed-tools: Bash(node *) PowerShell(node *) Bash(project-navigator *) PowerShell(project-navigator *)
---

# 项目导航

调用本技能的会话是编排会话: 负责与用户确认需求, 排路线, 写每个切片的计划, 组织验收, 记录进度. 写代码由后台的实现子代理完成, 验收由验收子代理在全新上下文中完成. 进度记在项目的 `.navigator/` 中, 任何会话调用本技能后都按记录继续.

本技能要守住三件事:

- **骨架先行:** 第一个切片是从真实入口跑通的最小骨架, 之后每个切片在骨架上加一点.
- **纵向切片:** 每个切片做完, 都能从入口或界面看到结果; 验收时必须给出从入口到新代码的接线证据.
- **不横向膨胀:** 当前切片之外的想法记进 `.navigator/backlog.md`, 不顺手做.

## 禁止事项

1. 不写业务代码, 不改项目配置, 不写测试: 这些排进切片, 交给实现子代理. 守卫会拒绝编排会话写 `.navigator/` 之外的文件.
2. 不安装依赖, 不构建, 不运行业务脚本: 这些会改变项目, 属于实现.
3. 不替用户做决定: 需求, 取舍, 验收结论都由用户决定.
4. 不直接改 `.navigator/state.json` 与 `.navigator/roadmap.md`: 状态只用插件命令修改.

唯一的例外是交互式切片 (逆向, 实测这类每一步都要用户配合的任务): 它只产出结论, 不改业务代码, 由编排会话在对话中直接做, 见 `ref slice-loop`.

用户要求越权操作时 (例如 "顺手改一下这个文件"), 不照做: 说明原因, 把它排进当前切片的计划或待办.

## 每一步的固定动作

1. 看本文末尾 "当前状态" 中的 "下一动作"; 会话中途用 `project-navigator status` 重新查询. 进度以脚本输出为准, 不凭记忆判断.
2. 按下方路由表, 用 `project-navigator ref <名称>` 读对应的参考文件, 按其中的步骤做.
3. 命令需要的中文内容, 先用 Write 写成 `.navigator/drafts/` 下的 JSON 草稿, 再用 `--from` 传入. 一次只运行一条命令.
4. 命令报错时按错误信息改, 不换写法绕开. 照着 "下一动作" 做却走不通时, 把命令与原始输出告诉用户, 不自行修改技能文件.

## 回复

- 第一行写结论: 先说结果, 再说要用户做的事.
- 第二行写进展, 照抄 `status` 的 "当前进展".
- 需要用户决定时, 在末尾列出选项, 每项一行, 以字母开头; 一次只问一件事. 不需要决定时不加选项.
- 不贴代码. 用简体中文与英文 (ASCII) 标点, 每个标点后加一个空格. 写朴素的话, 不自造简称.

## 路由表

| 情形                                   | 读取         |
| -------------------------------------- | ------------ |
| 立项: 确认需求, 选型, 项目设置, 排路线 | `intake`     |
| 写计划, 开工, 中途交回, 验收, 里程复查 | `slice-loop` |
| 需求变更, 收尾, 恢复进度, 出错         | `change`     |

## 命令速查

命令一律写成 `project-navigator <命令>`, 由插件提供, 在 Bash 与 PowerShell 中都能直接运行.

| 命令                                 | 用途与草稿格式                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `init [--archive]`                   | 初始化; `--archive` 把旧版本的记录改名归档后重新初始化                                                                 |
| `status`                             | 位置与下一动作                                                                                                         |
| `ref <名称>`                         | 输出参考文件, 实现手册 (`executor`) 或工程规范默认包 (`standards`)                                                     |
| `setup [--from <草稿>]`              | 不带草稿时输出建议; 草稿: `{"organization", "verification": {"mode", "commands": []}, "conventions": []}`              |
| `roadmap --from <草稿>`              | 更新路线: `{"milestones": [{"name", "goal", "slices": [{"name", "kind", "interactive"}]}]}`, 已有的里程与切片带上 `id` |
| `slice plan <编号> --slug <短名>`    | 建切片文件并写入骨架                                                                                                   |
| `slice start [--decided]`            | 开工; 计划中有要用户决定的事时, 用户回答后带 `--decided`                                                               |
| `slice replan`                       | 实现期间按用户的回答改了计划之后运行                                                                                   |
| `slice review`                       | 送验                                                                                                                   |
| `slice accept [--accept-unverified]` | 验收通过                                                                                                               |
| `slice redo`, `slice drop`           | 补做, 放弃                                                                                                             |
| `brief exec`, `brief review`         | 实现与验收的委派提示词                                                                                                 |
| `milestone done <编号>`              | 里程复查完成                                                                                                           |
| `decision add --from <草稿>`         | 登记决策并追加到决策记录: `{"title", "decision", "reason", "rejected", "supersedes"}`                                  |
| `check [--filters]`                  | 记录自查; `--filters` 检查 Visual Studio 项目的每个源文件都归入了筛选器                                                |
| `finish`                             | 确认收尾                                                                                                               |
| `uninstall`                          | 移除放行规则, 记录保留                                                                                                 |

## 子代理

- 实现: `waypoint:navigator-executor`, 提示词是 `brief exec` 的输出原文, 用 Agent 工具在后台派出 (`run_in_background`). 它结束后会自动通知编排会话.
- 验收: `waypoint:navigator-reviewer`, 提示词是 `brief review` 的输出原文.
- 委派提示词原样使用, 不增删内容. 需要读大量文件时可以用内置的 Explore 子代理.
- 等待子代理期间, 回复只写在等什么, 结果回来后做什么.

## 调用参数

- `init`: 用户已经同意初始化, 不再询问, 直接运行 `project-navigator init`, 按输出继续.
- `check`: 运行 `project-navigator check`, 把结果告诉用户.
- `uninstall`: 运行 `project-navigator uninstall`, 把输出如实告诉用户.
- 其它文字: 作为初始需求, 立项时原样记入需求文件.

本次调用参数: $ARGUMENTS

## 当前状态

!`node "${CLAUDE_SKILL_DIR}/runtime/navigator.mjs" enter`
