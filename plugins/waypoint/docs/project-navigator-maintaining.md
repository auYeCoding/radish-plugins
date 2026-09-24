# project-navigator 维护文档

[English](project-navigator-maintaining.en.md) | 简体中文

[返回使用说明](project-navigator.md)

本文面向维护者: 设计总览, 设计决策, 组件地图, 排查手册, 修改流程, 测试与实测结论. 仓库级的维护约定见 [MAINTAINING.md](../../../MAINTAINING.md).

## 设计总览

技能由三层组成, 每层只做一件事:

| 层       | 位置                                              | 职责                                         |
| -------- | ------------------------------------------------- | -------------------------------------------- |
| 规则     | `SKILL.md`, `references/`                         | 写给模型: 流程, 步骤, 何时回复哪种类型       |
| 运行脚本 | `runtime/navigator.mjs`, `runtime/hook.mjs`       | 命令行修改状态, hook 执行边界; 模型无法绕过  |
| 规格     | `spec/templates.json`, `standards/engineering.md` | 回复, 记录文件, 写作规则与工程规范的唯一来源 |

在用户项目中, 技能会用到以下位置:

| 位置                           | 内容                                                            | 是否入库 |
| ------------------------------ | --------------------------------------------------------------- | -------- |
| `.navigator/`                  | 状态文件, 记录文件, 执行手册, 运行脚本与参考文件的副本 (`bin/`) | 入库     |
| `.navigator/drafts/`           | 编排会话传给命令的 JSON 草稿                                    | 不入库   |
| `.claude/settings.json`        | 防护 hook 与放行规则                                            | 入库     |
| `.claude/settings.local.json`  | 放行规则的本机副本, 由 `.git/info/exclude` 排除                 | 不入库   |
| `.claude/rules/engineering.md` | 项目规范, 项目内所有会话自动加载                                | 入库     |
| `.git/navigator/`              | 执行会话登记, 自检请求与心跳, 源码证据缓存 (`evidence/`)        | 不入库   |
| `refs/navigator/snapshots`     | 状态目录的快照, 不进入分支历史                                  | 不入库   |

## 设计决策

每条写明决定, 原因, 以及改掉会怎样.

### 会话与边界

- **编排与执行分会话, 验收用子代理.** 规划与实现各自保持干净的上下文, 验收不受编排会话的倾向影响. 改掉的后果: 编排会话会开始写代码, 规划与实现重新混在一起.
- **编排会话的工具按白名单放行, 默认拒绝.** 新出现的工具 (例如 Monitor, Workflow, MCP 写工具) 不能绕过限制. 改掉的后果: 每个新工具都是一个旁路.
- **委派提示词由脚本生成, 守卫核对.** 验收提示词逐字核对, 调研提示词核对开头的固定框架. 改掉的后果: 编排会话可以在提示词中加入倾向性说明.
- **编排会话不用提问框.** 提问框出现时, 同一条回复中位于它之前的文字可能不会显示. 改掉的后果: 用户看不到选项所依据的内容.
- **执行会话在仓库根目录工作, 不使用 worktree.** worktree 中看不到尚未入库的工单. 改掉的后果: 执行会话找不到工单文件.

### 安装与配置

- **hook 装在项目级, 由 `init` 显式安装, 不放在插件级.** 有的仓库不是常规开发工程, 必须由用户显式选择. 改掉的后果: 装了插件的所有项目都会受限.
- **hook 用不经过 shell 的写法** (`"command": "node"`, `"args": ["${CLAUDE_PROJECT_DIR}/..."]`). 避开 Git Bash 与 PowerShell 的引号差异和含空格的路径. 改掉的后果: 路径含空格或中文时 hook 失败.
- **`SKILL.md` 设置 `allowed-tools: Bash(node *) PowerShell(node *)`, 不写 `shell` 字段.** 没有这项设置时, 默认权限模式下技能中的 `!` 命令会使整个调用中止; 子会话可能找不到 Git Bash. 该设置是仓库 "技能不设 `allowed-tools`" 约定的唯一例外. 改掉的后果: 技能在默认模式下无法打开.
- **放行规则同时写进 `settings.json` 与 `settings.local.json`.** 规则有两类: 插件命令, 以及 `Edit(.navigator/**)` (实测同时覆盖 Write 工具). 项目 `settings.json` 中的放行规则要等用户接受工作区信任后才生效, 无头模式永远不生效; 本机文件不需要信任. 放行只免去确认, 谁能写哪个文件仍由守卫决定. 改掉的后果: 每条插件命令与每次写记录文件都要用户确认.
- **插件命令一律写成 `node .navigator/bin/runtime/navigator.mjs <命令>`, 路径不加引号.** 放行规则按这个写法匹配. 改掉的后果: 命令弹出权限确认.
- **参考文件由 `init` 复制进 `.navigator/bin/references/`, `SKILL.md` 指向项目中的这一份.** 默认权限模式下, 读取项目之外的插件文件需要用户批准. 改掉的后果: 每读一次参考文件都弹出确认.
- **`.navigator/` 除草稿外全部入库, 插件在三处检查.** 入库的 hook 指向 `.navigator/bin/` 下的脚本, 对账依赖入库的状态文件. 项目模板中的 `lib/`, `bin/` 之类规则会漏掉运行脚本 (实例: Python 模板的 `lib/` 让 `.navigator/bin/runtime/lib/` 从未入库); `git add` 按目录暂存时遇到被忽略的文件不报错, 直接跳过.
  - init 写入的 `.navigator/.gitignore` 重新纳入各级目录与插件写的文件类型 (`.md`, `.mjs`, `.json`, `.gitignore`), 系统与编辑器的杂项文件仍按项目规则处理, 最后排除 `drafts/`.
  - init 与每次进入 (`enter`, `status`) 用 `git check-ignore --no-index` 检查必须入库的路径: 运行脚本副本, 固定文件, 规格中每种记录文件的示例位置, 以及 `.claude/settings.json` 与 `.claude/rules/engineering.md`. 这项检查覆盖项目各级 `.gitignore`, `.git/info/exclude` 与全局忽略文件. 上级规则忽略了 `.navigator/` 本身, 或忽略了 `.claude/` 下的配置时, 插件无法自己纳入: init 在改动其它文件之前停下, 进入时回复 "运行受阻", 都报告是哪条规则.
  - `order set committed` 核对 `.navigator/` 与上述两个配置文件中没有未入库的文件, 有则拒绝并列出, 要求在提交步骤中补交.
  - 改掉的后果: 换机器或 clone 之后 hook 找不到脚本, 守卫失效; 记录悄悄漏提交.
- **运行脚本只用 Node.js 22 内置模块.** hook 在用户机器上运行, 不能要求安装依赖. 改掉的后果: 初始化后还要在每个项目中装依赖.

### 状态与记录

- **`state.json` 是状态的唯一来源, hook 不写它.** 写入比较版本号, 先写临时文件再改名. 改掉的后果: 并发写入互相覆盖, 或写出半个文件.
- **`spec/templates.json` 是回复, 记录文件与写作规则的唯一来源.** Stop 校验, 写入校验, 骨架生成, 体检与参考文档都从规格读取. 改掉的后果: 文档与校验逐渐不一致.
- **回复与记录文件先取骨架再填写, "当前进展" 由脚本计算.** 模型容易数错进度或漏写节. 改掉的后果: 回复被打回的次数大幅增加.
- **规则在填写时给出, 回复结束时的校验只做兜底.** `reply` 在骨架之前输出填写要求, 由规格生成, 与校验用同一份阈值与词表. 执行会话的回复只校验版式, 所以只给版式与人类总结两条. 改掉的后果: 模型写回复时看不到规则, 打回次数增加.
- **"字" 只有一种算法** (`lib/text-units.mjs`): 汉字, 英文单词, 数字, 路径各算 1 字, 空格与标点不算, 句长与人类总结共用. 按字符计数时, 标点后的空格和英文路径会让总结比模型估计的长出一截. 改掉的后果: 人类总结频繁超出上限.
- **Stop 打回最多一次, 打回原因要求只改列出的问题.** `stop_hook_active` 为 true 时放行, 避免循环; 重写后的回复不再校验, 整条重写容易引入新错误. 改掉的后果: 模型可能反复重写同一条回复, 或在重写时带进新的错误.
- **回复从第一个一级标题算起, 标题之前的过程说明不打回, 但其中不能有代码块或标题.** 模型常在回复前加一句引导语. 打回只会让用户看到两遍同样的回复; 执行会话的开工对齐还会认不出来, 用户选 A 之后仍不能写业务文件. 改掉的后果: 许多回复被打回, 执行会话卡在开工对齐.
- **中文内容用 `.navigator/drafts/` 下的 JSON 草稿传给命令.** 子会话可能只有 PowerShell, Windows PowerShell 5.1 传中文参数会乱码. 改掉的后果: 中文内容乱码, 或命令因 heredoc 写法不同而失败.

### 对账与快照

- **快照存在隐藏引用中, 按原始字节存入 (`hash-object --no-filters`).** 不进分支历史, 不受 `core.autocrlf` 与 `.gitattributes` 影响, 恢复后逐字节一致. 改掉的后果: Windows 上恢复出的文件换行符改变.
- **快照提交使用固定身份 `project-navigator`.** 用户机器没有配置 Git 用户名与邮箱时, `git commit-tree` 会失败, 快照就悄悄拍不上. 改掉的后果: 在这类机器 (包括 CI) 上对账失去依据.
- **导航提交中入库的 `lastCommit` 等于其父提交.** 对账凭这一点认出自己的提交, 不需要额外标记; `init` 因此记录当时的 HEAD. 改掉的后果: 编排提交都被当成陌生提交.
- **对账异常未处理时, 暂停快照与大部分命令.** 否则下一个快照会把异常内容当成正常内容保存. 改掉的后果: 异常只提示一次, 之后悄悄消失.

### 执行与提交

- **启动提示词由脚本生成, hook 以首行 "执行工单 NNNN" 登记执行会话**, 读取当前工单文件作兜底; 当前或曾经的编排会话一律不登记. 改掉的后果: 执行会话无法被识别, 或编排会话被误登记为执行会话.
- **工单每次发布时 "发布轮次" 加一, 对齐只对本轮有效.** 受阻后重新发布的工单内容已经改变, 需要重新确认计划. 改掉的后果: 执行会话按旧计划继续写代码.
- **提交统一经过 `waypoint:commit-message`, 守卫只在提交步骤放行 `git add`, `git commit -F -` 与不带强制参数的 `git push`.** 提交消息规则只有一份. 改掉的后果: 出现两套提交消息规则.
- **开工对齐必须写 "模块划分" (新增模块, 改动模块, 入口改动).** 代码结构在动手之前定下, 用户选 A 之前能看到; 回复结束时校验这一节存在. 改掉的后果: 结构问题要到验收时才发现, 返工成本高.
- **模块化的机械检查交给项目的代码检查工具, 插件不解析代码.** 选型时选定检查工具并打开函数长度与复杂度规则, `codecheck set` 登记检查命令; 实现与修复工单的骨架预填 "代码检查通过" 判据, `order set issued` 核对判据原文, 检查命令自动算作已授权测试. 没有合适工具时必须写明原因登记. 改掉的后果: 模块化只靠提示与判断, 函数越写越长也能通过验收.
- **验收子代理的工具同时列出 Bash 与 PowerShell.** 子会话可能找不到 Git Bash, 只列 Bash 时验收子代理运行不了任何命令, 需要运行才能确认的判据都会变成 "未验证". 守卫对两者使用同一套规则. 改掉的后果: 在只有 PowerShell 的环境中验收全部不通过.

### 选型与验收结论

- **选型的源码证据写成表格, 由 `evidence` 命令从原仓库按版本取回被引用的行, 验收子代理只运行这条命令核对.** 证据在仓库之外, 而编排会话与验收子代理都不能联网, 以前验收子代理只能核对证据的格式, 核不了内容. git 取的是原始内容, 行号准确, 版本名或路径写错会直接报错; 网页抓取要经过模型转述, 行号不可靠, 所以不给验收子代理开联网工具. 每次只取深度为 1 的提交, 文件按需下载, 缓存在 `.git/navigator/evidence/`; 只接受 https 地址, git 不读凭据, 不弹提示. 守卫只放行不带参数的 `evidence`, 验收子代理不能借它访问任意地址. 改掉的后果: 源码证据无法独立核对, 只能靠执行会话自证, 或推给用户手工核对.
- **判据结论只有 通过, 不通过, 未验证 三种, 由脚本把关.** 取值写在规格的判据核对表中, `review.md` 写入时校验; 判据核对不全是通过时, `order set accepted` 与 `reply review --option 1` 都拒绝. 改掉的后果: 验收子代理可以自造 "部分验证" 之类的结论, 编排会话据此请用户人工补验, 绕过 "有未验证就不通过".
- **选型工单不通过时新建选型工单, 不发布修复工单.** 修复工单发布前要求已登记检查命令, 而检查命令在选型通过后才登记. 改掉的后果: 选型不通过之后流程卡住.
- **检查命令的检查范围排除 `.navigator/` 与 `.claude/`.** 有的格式化工具默认也处理 Markdown, 会把编排记录纳入检查, 而执行会话不能改这两个目录. 改掉的后果: 编排记录的格式让每张实现工单的 "代码检查通过" 判据都通不过.

## 组件地图

入口与命令:

| 文件                     | 职责                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `runtime/navigator.mjs`  | 命令行入口, 解析参数并分发; `enter` 任何情况下以退出码 0 结束 |
| `runtime/hook.mjs`       | 五种 hook 事件的统一入口                                      |
| `commands/init.mjs`      | 初始化, 升级与自检                                            |
| `commands/uninstall.mjs` | 移除 hook 与放行规则                                          |
| `commands/enter.mjs`     | `enter` 与 `status`: 环境检查, 对账, 会话登记, 下一动作       |
| `commands/reply.mjs`     | 回复的填写要求与骨架                                          |
| `commands/template.mjs`  | 记录文件骨架                                                  |
| `commands/stage.mjs`     | 阶段, 步骤, 跳过                                              |
| `commands/plan.mjs`      | 推进路线, 里程与切片状态                                      |
| `commands/order.mjs`     | 工单新建, 状态转换, 测试授权, 旧回执归档                      |
| `commands/records.mjs`   | 风险, 决策, 变更                                              |
| `commands/brief.mjs`     | 验收与调研的委派提示词                                        |
| `commands/evidence.mjs`  | 从原仓库取回选型回执证据表引用的源码行                        |
| `commands/snapshot.mjs`  | 快照列表, 恢复, 纳入                                          |
| `commands/check.mjs`     | 体检的脚本检查                                                |
| `commands/standards.mjs` | 写入项目规范                                                  |
| `commands/codecheck.mjs` | 登记代码检查命令                                              |
| `commands/support.mjs`   | 打开项目, 保存状态 (写入, 生成视图, 快照), 读取草稿           |

`runtime/lib/` 中的模块:

| 分组       | 文件                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 路径与状态 | `paths.mjs`, `state.mjs`, `numbering.mjs`, `validation.mjs`, `workflow-error.mjs`, `tracked-paths.mjs`                               |
| 规格与版式 | `spec.mjs`, `markdown.mjs`, `layout.mjs`, `reply-checks.mjs`, `file-checks.mjs`, `edits.mjs`, `writing-checks.mjs`, `text-units.mjs` |
| 生成       | `render.mjs`, `render-plan.mjs`, `table.mjs`, `briefs.mjs`, `reminders.mjs`, `guidance.mjs`, `reply-guide.mjs`, `writing-rules.mjs`  |
| 守卫       | `guard.mjs`, `guard-paths.mjs`, `guard-commands.mjs`                                                                                 |
| 会话       | `sessions.mjs`, `executors.mjs`, `registry.mjs`                                                                                      |
| 工作流     | `workflow-orders.mjs`, `workflow-plan.mjs`, `workflow-records.mjs`, `code-checks.mjs`, `review-record.mjs`                           |
| 源码证据   | `source-evidence.mjs` (证据表与核对输出), `source-fetch.mjs` (用 git 从第三方仓库取文件)                                             |
| 仓库与快照 | `repo.mjs`, `snapshots.mjs`, `reconcile.mjs`                                                                                         |
| 环境与配置 | `environment.mjs`, `version.mjs`, `settings.mjs`                                                                                     |

仓库中的其它部分:

- `plugins/waypoint/agents/navigator-*.md`: 验收, 调研与阅读子代理.
- `scripts/gen-navigator-docs.mjs`: 从规格生成 `references/replies.md`, `files.md`, `writing.md` 与 `guide/executor.md`; 手写部分在 `scripts/navigator-docs/`.
- `tests/project-navigator/`: 自动化测试.

## 排查手册

| 症状                                                                      | 根因                                                                               | 相关文件                                                           | 验证方法                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 调用技能时直接中止, 提示权限检查失败                                      | `allowed-tools` 被删除或改写                                                       | `SKILL.md`                                                         | 默认权限模式下调用一次                                                        |
| 自检未通过                                                                | 当前会话没有加载新的 hook, 或 hook 被全局设置禁用                                  | `commands/init.mjs`, `lib/settings.mjs`                            | 重启会话后再自检; 用标准输入驱动 `hook.mjs` 看输出                            |
| 插件命令弹出权限确认                                                      | 命令写法与放行规则不一致, 或本机配置缺失                                           | `lib/settings.mjs`, `lib/guard-commands.mjs`                       | 检查 `.claude/settings.local.json` 中的规则与命令原文                         |
| 回复反复被打回                                                            | 回复没有按骨架填写, 或规格与参考文件不一致                                         | `lib/reply-checks.mjs`, `spec/templates.json`                      | `reply` 取骨架后填写再校验; 运行 `npm test`                                   |
| 粘贴启动提示词后, 执行会话仍被当成其它会话                                | 首行被改动, 工单不是已发布状态, 或该会话曾是编排会话                               | `lib/executors.mjs`, `lib/briefs.mjs`                              | 查看 `.git/navigator/sessions/<会话编号>.json`                                |
| 用户选了 A, 执行会话仍不能写业务文件                                      | 开工对齐没有通过版式校验, 或工单重新发布后轮次改变                                 | `runtime/hook.mjs`, `lib/executors.mjs`                            | 查看登记文件的 `isAwaitingAlignment` 与 `alignedRound`                        |
| 每次调用都报记录文件与快照不符                                            | 快照之后有程序改写了 `.navigator/`, 而回复结束时的快照没有运行                     | `runtime/hook.mjs`, `lib/snapshots.mjs`                            | `git log refs/navigator/snapshots` 查看最近快照                               |
| 命令都报对账异常尚未处理                                                  | `state.json` 中有 `pendingAnomaly`                                                 | `commands/support.mjs`, `commands/enter.mjs`                       | 按验收异常流程运行 `adopt` 或 `restore`                                       |
| 实现工单发布被拒, 提到代码检查                                            | 项目未登记检查命令, 或工单的验收判据不含检查判据原文                               | `lib/code-checks.mjs`, `commands/order.mjs`                        | 查看 `state.json` 的 `codeChecks`; 重新取 `template order`                    |
| 升级插件后项目中的行为没变                                                | `plugin.json` 的版本没有提升, 项目副本不会提示升级                                 | `lib/version.mjs`                                                  | 比较 `.navigator/bin/runtime-version.json` 与插件版本                         |
| init 输出 "设置结果: 未执行", 或进入时要求回复 "运行受阻", 并列出忽略规则 | 项目的忽略规则忽略了 `.navigator/` 本身, `.claude/` 下的配置, 或其中必须入库的文件 | `commands/init.mjs`, `commands/enter.mjs`, `lib/tracked-paths.mjs` | `git check-ignore -v --no-index <路径>`                                       |
| `order set committed` 被拒, 列出没有入库的文件                            | 提交步骤漏选了 `.navigator/` 或插件管理的配置中的文件                              | `commands/order.mjs`                                               | `git status -- .navigator .claude/settings.json .claude/rules/engineering.md` |
| clone 之后 hook 报错, 找不到 `.navigator/bin/` 下的模块                   | 0.3.1 之前的版本没有重新纳入被项目规则忽略的运行脚本, 这些文件从未入库             | `commands/init.mjs`                                                | 在原机器上用 0.3.1 以上版本运行 init 升级, 提交 `.navigator/bin/`             |
| 派验收子代理被拒绝                                                        | 提示词不是 `review-brief` 的输出原文                                               | `lib/guard.mjs`                                                    | 重新运行 `review-brief`, 原样粘贴                                             |
| `evidence` 报取不到版本或文件                                             | 版本与仓库的 tag 写法不同, 路径写成了安装后的包内路径, 仓库需要账号, 或网络不通    | `lib/source-fetch.mjs`                                             | 用 `evidence check` 单条重试, 看输出中 git 的原始错误                         |
| `order set accepted` 或 `reply review --option 1` 被拒                    | `review.md` 的判据核对中有结论不是 "通过", 或缺少表格                              | `lib/review-record.mjs`                                            | 查看 `review.md` 的判据核对表                                                 |

## 修改流程

| 改了什么                     | 还要做                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `spec/templates.json`        | `npm run gen:docs`, `npm test`; 检查手写参考文件中引用的节名与选项组号                                                   |
| 回复类型中选项组的顺序       | 代码中引用了组号: `lib/guidance.mjs`, `commands/order.mjs`, `commands/enter.mjs`, `commands/reply.mjs`, 以及手写参考文件 |
| 证据表或判据核对表的列与取值 | `lib/source-evidence.mjs` 与 `lib/review-record.mjs` 中的常量; `spec.test.mjs` 核对两边一致                              |
| `scripts/navigator-docs/`    | `npm run gen:docs`                                                                                                       |
| `shared/punctuation.md`      | `npm run gen:docs`: 执行手册与 `writing.md` 内嵌了标点规则                                                               |
| `runtime/`                   | `npm test`; 发版时提升 `plugin.json` 的版本, 已初始化的项目才会提示运行 `init` 升级                                      |
| 状态文件的结构               | 提升 `STATE_SCHEMA_VERSION`, 在 `normalizeState` 中为旧状态补齐字段                                                      |
| `SKILL.md`                   | `npm test` 中的篇幅检查; 用 `claude -p` 冒烟                                                                             |
| 子代理的名称                 | `lib/guard.mjs` 的 `SUBAGENT_TYPES` 与 `SKILL.md`                                                                        |
| 插件名 `waypoint`            | `SUBAGENT_TYPES`, `COMMIT_SKILL`, 文档中的 `/waypoint:` 命令                                                             |

## 测试

- `npm test` 运行 `tests/project-navigator/` 中的全部测试:

| 文件                            | 覆盖内容                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `spec.test.mjs`                 | 标题与键名为 4 个汉字, 编号唯一, 同组选项宽度一致                                                                     |
| `reply-checks.test.mjs`         | 每种回复每组选项的填写样例合格, 常见违规被指出                                                                        |
| `file-checks.test.mjs`          | 每种记录文件的骨架合格, 条目与收尾节, 表格节, 编辑后重建全文                                                          |
| `evidence.test.mjs`             | 证据表的读取与写法校验, 从本机临时仓库按版本取行, 单条自查命令                                                        |
| `writing-checks.test.mjs`       | 每条写作规则一个命中例与一个不命中例                                                                                  |
| `guard.test.mjs`                | 身份, 工具, 路径或命令, 状态组成的决策表                                                                              |
| `workflow.test.mjs`             | 工单状态, 路线, 记录, 会话接管, 执行对齐, 下一动作                                                                    |
| `snapshots.test.mjs`            | 临时仓库中的快照去重, 逐字节恢复, 对账的各种情形                                                                      |
| `settings.test.mjs`             | 配置合并幂等, 卸载只删除自己的条目                                                                                    |
| `cli.test.mjs`, `flow.test.mjs` | 用项目内的命令行与 hook 走完初始化与进入 (含忽略规则检查), 工单往返, 验收结论把关, 提交收尾的入库检查, 异常处理与体检 |
| `docs.test.mjs`                 | 生成文档与规格同步, `SKILL.md` 篇幅上限                                                                               |

- `npm run gen:docs -- --check` 单独检查生成文档是否同步. CI 运行以上两项.

## 实测结论

在 Claude Code 2.1.280, Node.js 24.21.0, Windows 10 上实测 (2026-09-23), 项目路径含空格与中文:

| 待验证点            | 结论                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 技能中的 `!` 命令   | 不设 `allowed-tools` 时默认模式下整个调用中止; `${CLAUDE_SESSION_ID}` 与 hook 的 `session_id` 一致; 不触发 PreToolUse |
| 技能的 `shell` 字段 | 子会话中找不到 Git Bash 时, `shell: bash` 的技能直接报错                                                              |
| 子代理身份          | 子代理的 hook 输入带主会话的 `session_id`, 另有 `agent_id` 与 `agent_type`; 插件子代理的 `tools` 限制生效             |
| Stop 打回           | 顶层 `{"decision": "block"}` 生效, 第二次 Stop 的 `stop_hook_active` 为 true                                          |
| bypass 模式下的拒绝 | PreToolUse 的 `permissionDecision: "deny"` 仍然生效                                                                   |
| 上下文注入          | UserPromptSubmit 返回的 `additionalContext` 模型能读到; 斜杠命令也触发该事件                                          |
| 配置即时生效        | 会话中途写入项目 `settings.json` 的 hook 立即生效                                                                     |
| 会话名称            | ListAgents 输出的第一行是本会话名称                                                                                   |
| 放行规则            | 项目 `settings.json` 的放行规则需要工作区信任, 无头模式不生效; `settings.local.json` 不需要                           |

冒烟测试中的补充结论 (`claude -p`, 默认权限模式):

- 读取项目之外的插件参考文件, 以及写入 `.navigator/` 下的文件, 都需要用户批准; 分别由复制参考文件与 `Edit(.navigator/**)` 放行规则解决.
- `Edit(...)` 放行规则同时覆盖 Write 工具.
- 调研框架不设范围时, 一次立项调研超过 80 次网络调用, 耗时约 13 分钟; 框架现在限制为合计 20 次.

源码证据的获取 (git 2.55, 2026-09-23):

- 按 tag 或完整提交号从 GitHub 取一个文件的若干行, 深度为 1 且文件按需下载, 约 2 秒, 缓存约 100 KB.
- tag 写法不对 (例如少了 `v`) 与路径不对 (例如少了 `src/`) 都直接报错; 仓库不存在时约 2 秒内失败, 不弹凭据窗口.
- 远端是本机路径时, git 提示不支持按需下载并改为完整获取, 结果相同; 测试据此使用本机临时仓库.

尚待交互实测: bypass 模式下退出计划模式是否弹框, Agent Team 成员的会话身份, 跨会话消息开启的新回合是否触发 UserPromptSubmit. 设计已不依赖前两项的结果; Agent Team 在编排会话中默认禁用.

## 发版前手动测试

在临时仓库中用 `claude --plugin-dir ./plugins/waypoint` 逐项确认:

### 初始化与会话

1. 未初始化时回复 "初始设置"; 选 A 后完成自检, 选 B 不做任何修改.
2. 接受工作区信任对话框之前与之后, 插件命令都不弹权限确认.
3. 新会话恢复进度, 原编排会话不能再写记录.
4. 上下文压缩后, 编排会话收到位置提醒.
5. 卸载后 hook 与放行规则被移除, 记录保留.

### 立项与选型

1. 新建项目的立项: 需求理解, 问题域调研, 调研报告, 头脑风暴的发散与收敛, 项目简报.
2. 已有项目的盘点, 含运行检查工单.
3. 规范对照: 矛盾条目每轮不超过 3 条, 选定注释语言, 写入 `.claude/rules/engineering.md`.
4. 选型回执的证据表: 执行会话用 `evidence check` 自查; 验收子代理运行 `evidence` 核对; 版本或路径写错时判为未验证, 工单不通过, 下一动作是新建选型工单.
5. 语言选型后登记代码检查命令; 登记之前实现工单发布被拒, 登记之后工单骨架预填检查判据, 验收子代理能运行检查命令.

### 工单往返

1. 工单往返各做一次文档汇报与消息汇报.
2. 执行受阻后修改工单重新发布, 执行会话需要重新开工对齐.
3. 执行会话在用户选 A 之前写业务文件被拒绝, 提交被拒绝; 开工对齐中有 "模块划分", 缺少时被打回.
4. 需要外部影响的测试先回复 "测试授权".
5. 验收子代理交回结论与证据, 它尝试写文件时被拒绝.
6. 验收通过与不通过各一次; 同一切片连续两次不通过时建议重新拆分; 判据核对中有未验证时, `reply review --option 1` 与 `order set accepted` 被拒.
7. 三种提交方式都经过 `commit-message`, 提交后对账为一致.

### 变更, 复查与异常

1. 需求变更, 里程复查 (含自动体检), 手动体检.
2. `git reset` 回退, squash 合并, 手工修改记录文件后, 都能进入对应的验收异常.
3. 编排会话写代码, 装依赖, 使用提问框都被拒绝.
4. 回复版式违规被打回一次, 第二次放行.

## 已知限制

- 写作规则中的语义部分 (自造简称, 比喻, 指代不明) 只能靠提示词, 体检与禁用词表, 脚本检查是近似的.
- 打回时不合格的回复仍留在屏幕上.
- 命令行中的写入只能按命令文字粗查, 例如用脚本语言写文件无法识别.
- hook 不限制用户本人的操作; 用户手工改记录文件由对账发现.
- 每次工具调用多启动一次 Node.js, 本机实测约 70 毫秒, 只发生在已初始化的项目中.
- 源码证据只支持公开 git 仓库的 https 地址; 没有公开仓库的依赖只能判为未验证, 由用户决定. `evidence` 只核对被引用的行, 这些行是否真能支持 "说明" 仍由验收子代理判断.
