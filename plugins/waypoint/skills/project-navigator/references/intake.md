# 盘点, 立项与主线

本文件覆盖首次接入之后的阶段 0 盘点, 阶段 1 立项与阶段 2 主线. 每完成一步, 运行 `step <步骤标识>` 记下位置; 进入下一阶段时运行 `stage <编号>`, 再运行该阶段第一步的 `step`.

## 首次接入之后

- 用户选 A (新建项目): 写草稿 `{"reason": "新建项目, 没有已有代码"}`, 运行 `skip 0 --from <草稿>`, 再运行 `stage 1` 与 `step understanding`.
- 用户选 B (已有项目): 运行 `stage 0` 与 `step survey-read`.

## 阶段 0: 盘点

| 步骤标识        | 做什么             | 回复     |
| --------------- | ------------------ | -------- |
| survey-read     | 派阅读子代理读仓库 | 无       |
| survey-runcheck | 发布运行检查工单   | 工单发布 |
| survey-report   | 写现状报告         | 产出确认 |

1. survey-read: 派 `waypoint:navigator-reader` (仓库很大时可以派 Explore). 要求交回以下内容, 每条附文件路径:
   - 目录结构与模块划分, 技术栈与主要依赖, 程序入口.
   - 构建, 启动与测试命令.
   - 已有功能清单.
   - 已有规范: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, 格式化与检查配置.
2. survey-runcheck: 编排会话不能构建与运行程序. 新建运行检查工单 `order new --kind runcheck --slug runcheck`, 要求执行会话按盘点得到的命令构建, 启动, 测试, 原样记录结果, 不修改任何文件. 工单往返见 [order-loop.md](order-loop.md); 验收通过后只提交记录.
3. survey-report: 运行 `template survey`, 写 `.navigator/plan/survey.md`. "运行情况" 取自运行检查回执; 没有初始需求时, "目标差距" 写 "立项后补充". 回复 "产出确认".
4. 用户确认后运行 `stage 1` 与 `step understanding`. 现状报告的关键事实并入下一步的 "我的假设".

## 阶段 1: 立项

立项不能只问用户: 先调研, 形成基本认知并结构化汇报, 再带用户头脑风暴, 最后写简报.

| 步骤标识      | 做什么       | 回复     |
| ------------- | ------------ | -------- |
| understanding | 写回需求理解 | 需求理解 |
| research      | 问题域调研   | 调研报告 |
| brainstorm    | 发散讨论     | 头脑风暴 |
| converge      | 收敛结论     | 头脑风暴 |
| brief         | 写项目简报   | 产出确认 |

### 需求理解 (understanding)

- "原话摘录": 逐条摘录用户说过的需求原文, 不改写.
- "我的假设": 列出从原话推出的内容, 每条写明依据. 用户纠正之前, 假设不能作为后续步骤的依据.
- "调研方向": 列出准备调研的问题域话题, 3 至 5 个. 不列技术话题.
- 用户选 B: 按纠正改写, 再次回复 "需求理解". 用户选 A: 运行 `step research`.

### 问题域调研 (research)

1. 运行 `research-brief` 取得固定框架. 派 `waypoint:navigator-researcher`, 提示词是框架原文加上编号列出的调研问题. 守卫会核对框架没有被改动.
2. 运行 `template research`, 用子代理交回的结果写 `.navigator/plan/research.md`. "关键术语" 同步写进术语表 `.navigator/plan/glossary.md` 的 "项目术语".
3. 查到的技术话题只写进 "选型问题", 不讨论, 留给阶段 3.
4. 回复 "调研报告": "已知事实", "关键假设", "未知事项" 三节各列最重要的条目, 每条附依据. 只问一个问题: 哪条与你的认知不符.
5. 用户选 B: 修正用户指出的条目, 需要时补充调研, 再次回复. 用户选 A: 运行 `step brainstorm`, 按 [brainstorm.md](brainstorm.md) 进行.

### 项目简报 (brief)

1. 收敛结束后, 运行 `template brief`, 直接写 `.navigator/plan/brief.md`, 不经过中间文档. "简报版本" 写 1, "最近变更" 写 "无".
2. 自查四项: 没有占位符; 前后不矛盾; 范围与收敛结果一致; 没有两种读法的句子.
3. 运行 `check .navigator/plan/brief.md`, 修正问题级别的条目.
4. 回复 "产出确认". 用户的确认只批准本次展示的内容.
5. 确认后运行 `stage 2` 与 `step main-flow`.

## 阶段 2: 主线

| 步骤标识  | 做什么             | 回复     |
| --------- | ------------------ | -------- |
| main-flow | 写主线流程         | 产出确认 |
| roadmap   | 定推进路线与风险表 | 产出确认 |

### 主线流程 (main-flow)

运行 `template main-flow`, 写 `.navigator/plan/main-flow.md`:

- "场景清单": 从简报的使用场景列出, 标出核心场景.
- "主线步骤": 使用者完成核心场景的最短路径. 按顺序写每一步使用者做什么, 系统给出什么.
- "外部依赖": 主线涉及的外部系统, 账号与数据来源. 需要选型的条目标注 "待选型".

回复 "产出确认". 确认后运行 `step roadmap`.

### 推进路线 (roadmap)

1. 把简报拆成里程: 每个里程结束时能演示一个完整的使用者成果. 第一个里程的第一个切片是骨架, 即主线从头到尾跑通的最小版本.
2. 每个切片是一段使用者可见的功能, 做完即可运行. 不按层拆分, 例如不设 "先做完全部数据层" 这样的切片.
3. 写草稿 `.navigator/drafts/roadmap.json`, 运行 `roadmap --from .navigator/drafts/roadmap.json`, 脚本生成 `.navigator/plan/roadmap.md`.
4. 调研报告 "约束风险" 与主线中发现的风险, 用 `risk add` 逐条登记, 脚本生成 `.navigator/plan/risks.md`.
5. 回复 "产出确认", "文件路径" 写推进路线与风险清单两个文件.
6. 确认后运行 `stage 3` 与 `step standards`, 按 [selection.md](selection.md) 进行.
