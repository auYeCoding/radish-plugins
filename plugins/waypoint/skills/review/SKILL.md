---
name: review
description: Review captured WayPoint skill defects (commit-message, repo-init, project-navigator) and decide whether to iterate the skills. User-invoked only; does not auto-trigger and never changes skills on its own.
disable-model-invocation: true
---

# 技能自迭代复查

复查 waypoint 使用中记下的缺陷, 把反复出现的归因后交用户决定是否迭代技能. 本技能只呈现事实与建议, **不自行改任何技能** — 改技能必须由用户批准.

缺陷是怎么来的: 用户纠正某个 waypoint 简单技能 (commit-message, repo-init) 的结果时, 插件 hook 会提示代理往 `.waypoint/defects/` 追加一条只含事实的记录 (看到什么, 依据哪条规则或要点, 做了什么, 结果如何). 代理不下 "是规则错还是自己错" 的结论 — 那不可靠 (代理对自己理由的陈述常不忠实, 定位决定性错误也很难), 归因留到这里由人按固定分类表做.

project-navigator 有自己的编排流程与记录机制, 插件 hook 不在它的编排会话里弹提示; 你在使用中发现它的技能缺陷 (不是某张工单的问题, 而是技能本身的毛病) 时, 可手动往 `.waypoint/defects/` 记一条 (`"skill":"project-navigator"`), 本复查一并处理.

## 步骤

1. **汇总**: 运行

   ```
   node ${CLAUDE_PLUGIN_ROOT}/runtime/tools/review-defects.mjs
   ```

   它按模式键去重计数, 列出全部模式和达到提升阈值 (默认复现 >=3, 跨任务 >=2, 30 天内) 的模式. 未达阈值的不提请改技能 (避免把偶发当成规律).

2. **读记录**: 对每个达阈值的模式, 读 `.waypoint/defects/` 下对应的记录原文, 看清事实. 只问 "当时是什么情况, 怎么发生的", 不急着归一个 "根因".

3. **按固定分类表归因**: 给每个模式选一个类别:
   - `rule-gap` 规则没覆盖这种情形.
   - `not-triggered` 技能/hook 该触发却没触发到.
   - `lost` 规则在, 但长会话漂移或压缩后丢了.
   - `unclear` 规则有歧义, 照着做仍会错.
   - `ignored` 规则清楚也在, 但没遵守.
   - `not-skill` 不是技能能解决的 (模型能力或任务本身), 记为已知限制.

4. **提给用户决定**: 按类别给出改法建议, 交用户批准后再改:
   - `rule-gap` / `unclear`: 建议新增或改清一条规则 (对应技能的 `SKILL.md` 或 `references/`).
   - `not-triggered`: 若该技能靠 `description` 自动触发, 建议调描述; 若靠 hook, 建议调 hook 门控.
   - `lost`: 建议缩短/前置规则, 或让提示在压缩后重注入.
   - `ignored`: 若能做成确定性检查就下沉; 否则记为已知限制.
   - `not-skill`: 记入已知限制, 不改技能.
   - 用户批准前不改任何 `SKILL.md`, `references/` 或登记文件.

5. **收尾**: 把已处理的模式与决定记下来 (可在 `.waypoint/defects/` 内加一个 resolved 标记), 未达阈值的留着继续累积.

跨插件: 本复查针对 waypoint 自己命名空间下的技能; 其它插件 (如 tracepoint) 各自复查自己的, 不重复处理同一条. 共用的是 `runtime/lib/self-iteration.mjs` 的逻辑 (各插件内置一份), 不是同一个收件目录.
