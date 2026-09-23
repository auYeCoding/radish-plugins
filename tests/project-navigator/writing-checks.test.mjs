/**
 * @file 写作规则测试: 每条规则一个命中例与一个不命中例.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { renderTable } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/table.mjs";
import {
  checkWriting,
  formatFinding,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/writing-checks.mjs";

/**
 * 模板规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec}
 */
const SPEC = loadSpec();

/**
 * 写作规则.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").WritingSpec}
 */
const WRITING = SPEC.writing;

/**
 * 检查文本, 返回某一类别的问题.
 *
 * @param {string} text Markdown 文本.
 * @param {string} label 类别.
 * @param {number} [maxLines] 篇幅上限.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/writing-checks.mjs").WritingFinding[]} 该类别的问题.
 */
function findingsOf(text, label, maxLines) {
  return checkWriting({ text, spec: SPEC, maxLines }).filter(
    (finding) => finding.label === label,
  );
}

/**
 * 生成指定字数, 不含标点的汉字片段.
 *
 * @param {number} length 字数.
 * @returns {string} 片段.
 */
function hanPhrase(length) {
  return "字".repeat(length);
}

test("写作: 超长无标点片段判为问题", () => {
  const findings = findingsOf(
    `${hanPhrase(WRITING.sentence.maxLength + 1)}.`,
    WRITING.sentence.label,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "problem");
});

test("写作: 中等长度片段判为提示", () => {
  const findings = findingsOf(
    `${hanPhrase(WRITING.sentence.hintLength)}.`,
    WRITING.sentence.label,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "hint");
});

test("写作: 短句不报", () => {
  assert.deepEqual(findingsOf("第一句. 第二句.", WRITING.sentence.label), []);
});

test("写作: 英文单词, 路径与行内代码各按一个字计算", () => {
  const text = `打开 .navigator/orders/0001-x/order.md 与 \`${"x".repeat(200)}\` 两个位置.`;
  assert.deepEqual(findingsOf(text, WRITING.sentence.label), []);
});

test("写作: 段落超过行数上限", () => {
  const paragraph = Array.from(
    { length: WRITING.paragraph.maxLines + 1 },
    () => "一行.",
  ).join("\n");
  assert.equal(findingsOf(paragraph, WRITING.paragraph.label).length, 1);
});

test("写作: 段落不超过行数上限", () => {
  const paragraph = Array.from(
    { length: WRITING.paragraph.maxLines },
    () => "一行.",
  ).join("\n");
  assert.deepEqual(findingsOf(paragraph, WRITING.paragraph.label), []);
});

test("写作: 同一层列表超过项数上限", () => {
  const list = Array.from(
    { length: WRITING.listLength.maxItems + 1 },
    (_item, index) => `- 第 ${index} 项.`,
  ).join("\n");
  assert.equal(findingsOf(list, WRITING.listLength.label).length, 1);
});

test("写作: 空行不打断列表, 标题打断列表", () => {
  const half = Array.from(
    { length: WRITING.listLength.maxItems },
    (_item, index) => `- 第 ${index} 项.`,
  ).join("\n");
  assert.equal(
    findingsOf(`${half}\n\n- 再一项.`, WRITING.listLength.label).length,
    1,
  );
  assert.deepEqual(
    findingsOf(`${half}\n\n## 新节\n\n- 再一项.`, WRITING.listLength.label),
    [],
  );
});

test("写作: 列表嵌套超过层数上限", () => {
  const list = ["- 一层.", "  - 两层.", "    - 三层."].join("\n");
  assert.equal(findingsOf(list, WRITING.listDepth.label).length, 1);
  assert.deepEqual(
    findingsOf(["- 一层.", "  - 两层."].join("\n"), WRITING.listDepth.label),
    [],
  );
});

test("写作: 一节中加粗过多", () => {
  const text = "**一**, **二**, **三**, **四**.";
  const findings = findingsOf(text, WRITING.bold.label);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "hint");
  assert.deepEqual(findingsOf("**一**, **二**.", WRITING.bold.label), []);
});

test('写作: 一个片段中 "的" 过多', () => {
  assert.equal(
    findingsOf("我的朋友的书的封面.", WRITING.particle.label).length,
    1,
  );
  assert.deepEqual(findingsOf("我的朋友的书.", WRITING.particle.label), []);
});

test("写作: 黑话与比喻用词", () => {
  assert.equal(findingsOf("方案可以赋能团队.", WRITING.jargon.label).length, 1);
  assert.equal(findingsOf("流程就像一条河.", WRITING.metaphor.label).length, 1);
  assert.deepEqual(findingsOf("方案可以帮助团队.", WRITING.jargon.label), []);
});

test("写作: 翻译腔句式", () => {
  const findings = findingsOf("我们进行测试.", WRITING.translationese.label);
  assert.equal(findings.length, 1);
  assert.match(formatFinding(findings[0]), /进行测试/u);
  assert.deepEqual(findingsOf("我们测试.", WRITING.translationese.label), []);
});

test("写作: 句首裸指代词", () => {
  assert.equal(findingsOf("它会自动保存.", WRITING.pronoun.label).length, 1);
  assert.equal(
    findingsOf("- 结果: 这是预期行为.", WRITING.pronoun.label).length,
    1,
  );
  assert.deepEqual(
    findingsOf("此外, 工单已发布. 其中两项已完成.", WRITING.pronoun.label),
    [],
  );
});

test("写作: 表格源码未对齐", () => {
  const aligned = renderTable(["名称", "说明"], [["工单", "一项任务"]]).join(
    "\n",
  );
  assert.deepEqual(findingsOf(aligned, WRITING.table.label), []);
  const misaligned = [
    "| 名称 | 说明 |",
    "| --- | --- |",
    "| 工单 | 一项任务 |",
  ].join("\n");
  assert.equal(findingsOf(misaligned, WRITING.table.label).length, 1);
});

test("写作: 篇幅超过上限", () => {
  const text = ["一.", "", "二.", "", "三.", "", "四."].join("\n");
  assert.equal(findingsOf(text, WRITING.length.label, 3).length, 1);
  assert.deepEqual(findingsOf(text, WRITING.length.label, undefined), []);
});

test("写作: 代码块不检查, 人类总结块检查", () => {
  const code = ["```js", `const value = "${hanPhrase(60)}";`, "```"].join("\n");
  assert.deepEqual(
    checkWriting({ text: code, spec: SPEC, maxLines: undefined }),
    [],
  );
  const summary = [
    "```text",
    SPEC.format.summarySeparator,
    "本轮赋能团队.",
    "```",
  ].join("\n");
  const findings = findingsOf(summary, WRITING.jargon.label);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
});
