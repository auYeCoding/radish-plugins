---
name: review
description: Review captured TracePoint skill defects and decide whether to iterate the skills. User-invoked only; does not auto-trigger and does not change skills on its own.
disable-model-invocation: true
---

# 技能自迭代复查

复查 tracepoint 使用中记下的缺陷, 把反复出现的归因后交用户决定是否迭代技能. 本技能只呈现事实与建议, **不自行改任何技能** — 改技能必须由用户批准.

缺陷是怎么来的: 用户纠正时 hook 会提示代理往 `.tracepoint/defects/` 追加一条只含事实的记录 (看到什么, 依据哪条规则, 做了什么, 结果如何). 代理不下 "是规则错还是自己错" 的结论 — 那不可靠 (代理对自己理由的陈述常不忠实, 定位决定性错误也很难), 归因留到这里由人按固定分类表做.

## 步骤

1. **汇总**: 运行

   ```
   node ${CLAUDE_PLUGIN_ROOT}/runtime/tools/review-defects.mjs
   ```

   它按模式键去重计数, 列出全部模式和达到提升阈值 (默认复现 >=3, 跨任务 >=2, 30 天内) 的模式. 未达阈值的不提请改技能 (避免把偶发当成规律).

2. **读记录**: 对每个达阈值的模式, 读 `.tracepoint/defects/` 下对应的记录原文, 看清事实. 只问 "当时是什么情况, 怎么发生的", 不急着归一个 "根因".

3. **按固定分类表归因**: 给每个模式选一个类别 (这一步可交无本次上下文的子代理按同一张表做, 一致性更好):
   - `rule-gap` 规则没覆盖这种情形.
   - `not-triggered` 有规则但技能/hook 没触发到.
   - `lost` 规则在, 但长会话漂移或压缩后丢了.
   - `unclear` 规则有歧义, 照着做仍会错.
   - `ignored` 规则清楚也在, 但没遵守.
   - `not-skill` 不是技能能解决的 (模型能力或目标难度), 记为已知限制.

4. **提给用户决定**: 按类别给出改法建议, 交用户批准后再改:
   - `rule-gap` / `unclear`: 建议新增或改清一条规则 (对应技能的 `SKILL.md`).
   - `not-triggered`: 建议把该规则从技能正文移到插件 hook (hook 不依赖技能被选中).
   - `lost`: 建议缩短/前置规则, 或让 hook 在压缩后重注入.
   - `ignored`: 若能做成确定性检查 (如校验器), 建议下沉; 否则记为已知限制.
   - `not-skill`: 记为已知限制, 不改技能.
   - 用户批准前不改任何 `SKILL.md`.

5. **收尾**: 把已处理的模式与决定记下来 (可在 `.tracepoint/defects/` 内加一个 resolved 标记), 未达阈值的留着继续累积.

跨插件: 本复查针对 tracepoint 自己命名空间下的技能; 其它插件 (如 waypoint) 各自复查自己的, 不重复处理同一条. 共用的是 `runtime/lib/self-iteration.mjs` 的逻辑, 不是同一个收件目录.
