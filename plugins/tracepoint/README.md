# TracePoint

[English](README.en.md) | 简体中文

[![TracePoint version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FauYeCoding%2Fradish-plugins%2Fmain%2Fplugins%2Ftracepoint%2F.claude-plugin%2Fplugin.json&query=%24.version&label=tracepoint)](CHANGELOG.md)

TracePoint 是一个为逆向分析提供工作流与规范化约束的 [Claude Code](https://code.claude.com) 插件. 它给每个逆向目标维护一份案卷, 强制结论带位置证据, 把计算交给工具, 以反汇编为准, 给分析设预算以免空转或提前收工; 另有一章分析带保护代码的通用方法, 以及一套由用户把关的技能自迭代机制. 技能正文, 案卷与缺陷记录都使用简体中文.

重心是流程, 不是技巧大全. TracePoint 不教某个算法怎么认, 也不写针对任何具体产品的绕过步骤; 它约束的是 "怎么分析才不出错, 不重复, 不半途编造".

## 使用前提

- [Node.js](https://nodejs.org) 22 或更高版本 (hook 与脚本只用内置模块).
- 按需准备逆向工具及其 MCP 服务: 反汇编/反编译器 (IDA/idalib, Ghidra, radare2, DHS), 调试器 (x64dbg, DHS, Cheat Engine), 移动端 (jadx, Jeb, Frida, `adb`). 这些 MCP 要等对应软件打开才连得上; `discover-mcp` 会列出配置里有哪些, 哪些还没连上.
- 目标目录不要求是 Git 仓库.

## 组成

| 组成                                       | 触发                                                                           | 作用                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [`analyze`](docs/analyze.md)               | 分析编译产物时自动触发, 或 `/tracepoint:analyze`                               | 逆向工作流纪律: 开案卷, 工具就位, 结论带证据, 算计算交工具, 以反汇编为准, 查重与预算.           |
| [`protected-code`](docs/protected-code.md) | 遇到保护 (加壳/虚拟机/混淆/反调试) 时自动触发, 或 `/tracepoint:protected-code` | 分析带保护代码的通用方法: 先识别保护类型, 再定静态还是动态; 诚实写明模型能做与不能做.           |
| [`review`](docs/review.md)                 | 仅 `/tracepoint:review`                                                        | 复查记下的技能缺陷, 按固定分类表归因, 把反复出现的提请用户决定是否迭代技能; **不自行改技能**.   |
| 插件 hook                                  | 会话开始/每轮/MCP 调用后 (自动)                                                | 只注入案卷上下文与记录进度, **不拒绝任何工具调用**. 门控在 `.tracepoint/`: 没有案卷时完全静默.  |
| 案卷                                       | `analyze` 开工时建                                                             | 目标目录内的 `.tracepoint/case.json`: 已分析的函数, 带证据的结论, 保护类型, 待办与已试过的方法. |

脚本 (`runtime/tools/`): `discover-mcp.mjs` 发现配置里的逆向 MCP 并提示先打开软件; `check-case.mjs` 校验每条结论都带位置证据 (零项判失败); `review-defects.mjs` 汇总缺陷记录, 列出达到提升阈值的模式.

## 快速上手

1. 在逆向目标所在目录开一个会话, 对 Claude 说 "帮我逆向分析这个程序" (或直接 `/tracepoint:analyze`). 它会在目标目录建 `.tracepoint/case.json` 作为案卷, 并运行 `discover-mcp` 检查逆向工具是否就位.
2. 建好案卷后, hook 会在会话开始, 压缩后与每轮把案卷注入上下文, 并把 MCP 工具调用记进案卷供查重. 动手前先读案卷, 不重复已做的分析.
3. 遇到加壳, 虚拟机或混淆, Claude 会用 `protected-code` 的方法先判保护类型再决定分析路径.
4. 分析告一段落, 可运行 `check-case` 核对结论是否都带位置证据.

案卷默认不入库: 在目标目录的 `.gitignore` 里忽略 `.tracepoint/` 即可.

## 技能自迭代

TracePoint 会在你纠正它时提示代理往 `.tracepoint/defects/` 追加一条只含事实的缺陷记录 (看到什么, 依据哪条规则, 做了什么, 结果如何), 不让代理自己下 "是规则错还是自己错" 的结论. 之后运行 `/tracepoint:review` 汇总: 对反复出现 (跨任务, 近期) 的模式按固定分类表归因, 给出改法建议, **是否改技能由你决定**. 这套逻辑 (`runtime/lib/self-iteration.mjs`) 通用, 可供同一插件包里的其它插件各自复用, 彼此不重复记录.

## 与其它插件共存

TracePoint 设计为可与插件包里的其它插件 (如 WayPoint 的 `project-navigator`) 和用户的全局 hook 在同一项目共存:

- 只占目标目录内的一个点目录 `.tracepoint/`, 不写 `.claude/` 下的文件, 不占用别的插件的位置.
- hook 只注入与记录, 不拒绝任何工具调用, 不规定回复的结构; 没有 `.tracepoint/` 时完全静默, 子代理里不注入.
- 目标暂停在调试器里时, hook 对调试器调用只记录不拒绝.
- 各插件的自迭代只处理自己命名空间下的技能.

## 安装

见插件市场 README 中的 [安装](../../README.md#安装) 一节.

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md).

## 许可证

[MIT](../../LICENSE)
