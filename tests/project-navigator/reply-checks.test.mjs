/**
 * @file 回复版式校验测试: 骨架填写后应合格, 常见违规应被指出.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { blankFreeformSections } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/freeform-sections.mjs";
import { checkReply } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/reply-checks.mjs";
import {
  PLACEHOLDER,
  renderReplySkeleton,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { checkWriting } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/writing-checks.mjs";

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
 * 以编排会话身份校验回复.
 *
 * @param {string} text 回复全文.
 * @returns {string[]} 问题列表.
 */
function check(text) {
  return checkReply({
    text,
    spec: SPEC,
    state: undefined,
    role: "orchestrator",
  });
}

for (const [type, reply] of Object.entries(SPEC.replies)) {
  if (reply.role !== "orchestrator") {
    continue;
  }
  reply.optionSets.forEach((_set, index) => {
    test(`校验: "${type}" 第 ${index + 1} 组选项的填写样例合格`, () => {
      assert.deepEqual(check(filledReply(type, index)), []);
    });
  });
}

test("校验: 缺少一级标题", () => {
  const text = filledReply("首次接入").replace("# 首次接入\n", "");
  assert.equal(check(text).length, 1);
});

test("校验: 标题前的一句过程说明不算违规", () => {
  const text = `自检已通过, 下面是回复.\n\n---\n\n${filledReply("首次接入")}`;
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

test("校验: 节中贴代码", () => {
  const text = filledReply("首次接入").replace(
    "## 仓库情况\n",
    "## 仓库情况\n\n```js\nconsole.log(1)\n```\n",
  );
  assert.ok(check(text).some((problem) => problem.includes("不能贴代码")));
});

test("校验: 自由正文可以放代码块与三级标题, 其它节仍不能贴代码", () => {
  const body = "### 现象\n\n```text\nM .navigator/state.json\n```\n";
  const freeform = filledReply("自由答复").replace(
    `## 答复内容\n\n${FILLER}\n`,
    `## 答复内容\n\n${FILLER}\n\n${body}`,
  );
  assert.ok(freeform.includes(body));
  assert.deepEqual(check(freeform), []);
  const other = filledReply("首次接入").replace(
    "## 仓库情况\n",
    `## 仓库情况\n\n${body}`,
  );
  assert.ok(check(other).some((problem) => problem.includes("不能贴代码")));
});

test("写作规则: 自由正文不检查, 人类总结仍然检查", () => {
  const word = SPEC.writing.jargon.words[0];
  const text = filledReply("自由答复")
    .replace(`## 答复内容\n\n${FILLER}\n`, `## 答复内容\n\n报告提到${word}.\n`)
    .replace(/```text\n(.+)\n/u, `\`\`\`text\n$1\n总结提到${word}.\n`);
  const lines = checkWriting({
    text: blankFreeformSections(text, SPEC.replies["自由答复"]),
    spec: SPEC,
    maxLines: undefined,
  })
    .filter((finding) => finding.label === SPEC.writing.jargon.label)
    .map((finding) => text.split("\n")[finding.line - 1]);
  assert.deepEqual(lines, [`总结提到${word}.`]);
});

test("校验: 改动固定选项", () => {
  const text = filledReply("首次接入").replace(
    "A. 新建项目, 从立项开始.",
    "A. 新建项目.",
  );
  assert.ok(check(text).some((problem) => problem.includes("选项块")));
});

test("校验: 人类总结超过字数上限", () => {
  const longSummary = "很".repeat(SPEC.format.summaryMaxLength + 1);
  const text = filledReply("首次接入").replace(
    `${SPEC.format.summarySeparator}\n${FILLER}`,
    `${SPEC.format.summarySeparator}\n${longSummary}`,
  );
  assert.ok(check(text).some((problem) => problem.includes("上限")));
});

test("校验: 人类总结按汉字与单词计数, 空格与标点不算", () => {
  const summary = `${"很".repeat(SPEC.format.summaryMaxLength - 10)}, 运行 main.py, 修改 src/app.js, 然后提交.`;
  assert.ok([...summary].length > SPEC.format.summaryMaxLength);
  const text = filledReply("首次接入").replace(
    `${SPEC.format.summarySeparator}\n${FILLER}`,
    `${SPEC.format.summarySeparator}\n${summary}`,
  );
  assert.deepEqual(check(text), []);
});

test("校验: 缺少人类总结", () => {
  const text = filledReply("首次接入").replace(
    /```text\n[\s\S]*?\n```\n?$/u,
    "",
  );
  assert.ok(check(text).some((problem) => problem.includes("人类总结")));
});

test("校验: 当前进展与状态不符", () => {
  const text = filledReply("首次接入").replace(
    "- 当前阶段: 无",
    "- 当前阶段: 2/6 (主线)",
  );
  assert.ok(check(text).some((problem) => problem.includes("当前阶段")));
});

test("校验: 节标题顺序错误", () => {
  const text = filledReply("初始设置")
    .replace("## 检查结果", "## 临时标题")
    .replace("## 设置内容", "## 检查结果")
    .replace("## 临时标题", "## 设置内容");
  assert.ok(check(text).some((problem) => problem.includes("二级标题")));
});
