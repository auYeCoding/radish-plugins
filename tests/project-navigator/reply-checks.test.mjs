/**
 * @file 回复结构校验测试: 骨架填写后应合格, 结构问题应被指出, 写作与节的问题不打回.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkReply } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/reply-checks.mjs";
import {
  PLACEHOLDER,
  renderReplySkeleton,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";

/**
 * 模板规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec}
 */
const SPEC = loadSpec();

/**
 * 填写骨架中占位符时使用的文字.
 * @type {string}
 */
const FILLER = "已填写的内容";

/**
 * 生成某种回复的合格样例: 骨架中的占位符全部替换为内容.
 *
 * @param {string} type 回复类型.
 * @param {number} [optionSetIndex] 选项组下标.
 * @returns {string} 合格的回复.
 */
function filledReply(type, optionSetIndex = 0) {
  return renderReplySkeleton({
    type,
    optionSetIndex,
    state: undefined,
    spec: SPEC,
  })
    .split(PLACEHOLDER)
    .join(FILLER);
}

/**
 * 校验回复的结构.
 *
 * @param {string} text 回复全文.
 * @returns {string[]} 问题列表.
 */
function check(text) {
  return checkReply({ text, spec: SPEC });
}

for (const [type, reply] of Object.entries(SPEC.replies)) {
  reply.optionSets.forEach((_set, index) => {
    test(`校验: "${type}" 第 ${index + 1} 组选项的填写样例合格`, () => {
      assert.deepEqual(check(filledReply(type, index)), []);
    });
  });
}

test("校验: 不需要用户选择的回复不带选项块, 带了会被指出", () => {
  const reply = filledReply("工单执行");
  assert.doesNotMatch(reply, /```/u);
  assert.deepEqual(check(reply), []);
  const withOptions = `${reply}\n\`\`\`\n[如何继续]\n\nA. 等待完成, 自动汇报.\n\`\`\`\n`;
  assert.ok(check(withOptions).some((problem) => problem.includes("选项块")));
});

test("校验: 缺少一级标题", () => {
  const text = filledReply("首次接入").replace("# 首次接入\n", "");
  assert.equal(check(text).length, 1);
});

test("校验: 标题前的一句过程说明不算违规", () => {
  const text = `自检已通过, 下面是回复.\n\n${filledReply("首次接入")}`;
  assert.deepEqual(check(text), []);
});

test("校验: 标题前不能有代码块", () => {
  const text = `\`\`\`js\nconsole.log(1)\n\`\`\`\n\n${filledReply("首次接入")}`;
  assert.ok(check(text).some((problem) => problem.includes("过程说明")));
});

test("校验: 未知的回复类型", () => {
  const text = filledReply("首次接入").replace("# 首次接入", "# 随便写写");
  assert.match(check(text)[0], /不是允许的回复类型/u);
});

test("校验: 残留占位符", () => {
  const skeleton = renderReplySkeleton({
    type: "首次接入",
    state: undefined,
    spec: SPEC,
  });
  assert.ok(check(skeleton).some((problem) => problem.includes(PLACEHOLDER)));
});

test("校验: 标题下方缺少结论行, 或结论为空", () => {
  const missing = filledReply("首次接入").replace(`结论: ${FILLER}\n`, "");
  assert.ok(check(missing).some((problem) => problem.includes("结论行")));
  const empty = filledReply("首次接入").replace(`结论: ${FILLER}`, "结论: ");
  assert.ok(check(empty).some((problem) => problem.includes("结论行")));
});

test("校验: 结论很长也不打回, 字数只是提醒", () => {
  const conclusion = "很".repeat(SPEC.format.conclusionMaxLength * 3);
  const text = filledReply("首次接入").replace(
    `结论: ${FILLER}`,
    `结论: ${conclusion}`,
  );
  assert.deepEqual(check(text), []);
});

test("校验: 写作规则与节结构不打回", () => {
  const word = SPEC.writing.jargon.words[0];
  const text = filledReply("初始设置")
    .replace("## 设置内容", "## 随便一节")
    .replace(`- 版本控制: ${FILLER}`, `这里提到${word}, 而且没有键名.`);
  assert.deepEqual(check(text), []);
});

test("校验: 节中贴代码", () => {
  const text = filledReply("首次接入").replace(
    "## 仓库情况\n",
    "## 仓库情况\n\n```js\nconsole.log(1)\n```\n",
  );
  assert.ok(check(text).some((problem) => problem.includes("不能贴代码")));
});

test("校验: 自由正文可以放代码块与三级标题", () => {
  const body = "### 现象\n\n```text\nM .navigator/state.json\n```\n";
  const freeform = filledReply("自由答复").replace(
    `## 答复内容\n\n${FILLER}\n`,
    `## 答复内容\n\n${FILLER}\n\n${body}`,
  );
  assert.ok(freeform.includes(body));
  assert.deepEqual(check(freeform), []);
  const report = filledReply("问题报告").replace(
    `## 报告内容\n\n${FILLER}\n`,
    `## 报告内容\n\n${body}`,
  );
  assert.ok(report.includes(body));
  assert.deepEqual(check(report), []);
});

test("校验: 改动固定选项", () => {
  const text = filledReply("首次接入").replace(
    "A. 新建项目, 从立项开始.",
    "A. 新建项目.",
  );
  assert.ok(check(text).some((problem) => problem.includes("选项块")));
});

test("校验: 缺少选项块", () => {
  const text = filledReply("首次接入").replace(/```\n\[[\s\S]*?```\n?$/u, "");
  assert.ok(check(text).some((problem) => problem.includes("选项块")));
});
