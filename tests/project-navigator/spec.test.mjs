/**
 * @file 模板规格自检: 标题, 键名与选项符合全局版式规则.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { displayWidth } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/table.mjs";

/**
 * 模板规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec}
 */
const SPEC = loadSpec();

/**
 * 汉字的匹配规则.
 * @type {RegExp}
 */
const CJK_PATTERN = /^\p{Script=Han}+$/u;

/**
 * 写作规则允许的级别.
 * @type {readonly string[]}
 */
const SEVERITIES = Object.freeze(["problem", "hint"]);

/**
 * 断言文字恰好由规定数量的汉字组成.
 *
 * @param {string} text 文字.
 * @param {string} label 出错时显示的位置说明.
 * @returns {void}
 */
function assertFourHan(text, label) {
  assert.ok(
    CJK_PATTERN.test(text) && [...text].length === SPEC.format.titleLength,
    `${label} "${text}" 必须是 ${SPEC.format.titleLength} 个汉字`,
  );
}

test("规格: 进展标题与键名都是 4 个汉字", () => {
  assertFourHan(SPEC.format.progressTitle, "进展标题");
  for (const key of SPEC.format.progressKeys) {
    assertFourHan(key, "进展键名");
  }
});

test("规格: 回复类型的英文编号唯一, 且只含小写字母与连字符", () => {
  const ids = Object.values(SPEC.replies).map((reply) => reply.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z]+(?:-[a-z]+)*$/u);
  }
});

test("规格: 写作规则的类别都是 4 个汉字, 级别合法, 类别不重复", () => {
  const labels = Object.values(SPEC.writing).map((rule) => rule.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const rule of Object.values(SPEC.writing)) {
    assertFourHan(rule.label, "写作规则类别");
    assert.ok(SEVERITIES.includes(rule.severity), `${rule.label} 的级别不合法`);
  }
});

for (const [kind, fileSpec] of Object.entries(SPEC.files)) {
  test(`规格: 文件 "${kind}" 的标题与键名符合版式规则`, () => {
    assertFourHan(fileSpec.title, `${kind} 的一级标题`);
    const sections = [
      ...(fileSpec.variants ?? [fileSpec.sections ?? []]).flat(),
      ...(fileSpec.closingSections ?? []),
    ];
    for (const section of sections) {
      assertFourHan(section.title, `${kind} 的节标题`);
      for (const key of section.keys ?? []) {
        assertFourHan(key, `${kind} 的键名`);
      }
    }
    for (const key of fileSpec.entryKeys ?? []) {
      assertFourHan(key, `${kind} 的条目键名`);
    }
  });
}

for (const [type, reply] of Object.entries(SPEC.replies)) {
  test(`规格: "${type}" 的标题, 键名与选项符合版式规则`, () => {
    assertFourHan(type, "回复类型");
    for (const section of reply.sections) {
      assertFourHan(section.title, `${type} 的节标题`);
      for (const key of section.keys ?? []) {
        assertFourHan(key, `${type} 的键名`);
      }
    }
    assert.ok(reply.optionSets.length > 0, `${type} 至少要有一组选项`);
    for (const set of reply.optionSets) {
      assertFourHan(set.title, `${type} 的选项标题`);
      const widths = set.choices.map((choice) => displayWidth(choice));
      assert.ok(
        Math.max(...widths) - Math.min(...widths) <= 1,
        `${type} 的选项 "${set.title}" 各项显示宽度应一致: ${widths.join(", ")}`,
      );
    }
  });
}
