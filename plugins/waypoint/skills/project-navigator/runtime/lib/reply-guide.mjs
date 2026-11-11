/**
 * @file reply 命令在骨架之前给出的填写要求: 版式要点, 结论行的写法, 以及写作建议.
 *
 * 回复结束时只校验结构 (标题, 结论行, 选项块); 结论的字数与写作规则都是提醒,
 * 不打回. 内容全部由规格生成, 与体检使用同一份阈值与词表.
 */

import { FREEFORM_RULE } from "./freeform-sections.mjs";
import { PLACEHOLDER } from "./render.mjs";
import { isFreeformSection } from "./spec.mjs";
import { UNIT_RULE } from "./text-units.mjs";
import { describeWritingRules } from "./writing-rules.mjs";

/**
 * 写作建议中列出的规则级别.
 * @type {string}
 */
const ADVISED_SEVERITY = "problem";

/**
 * 按词表检查的写作规则, 填写要求中直接列出词表.
 * @type {readonly string[]}
 */
const WORD_LIST_RULES = Object.freeze(["jargon", "metaphor"]);

/**
 * 只适用于记录文件的写作规则.
 * @type {readonly string[]}
 */
const FILE_ONLY_RULES = Object.freeze(["structure"]);

/**
 * 生成填写要求, 以 "骨架:" 与一个空行结束, 其后紧接骨架.
 *
 * @param {object} options 生成参数.
 * @param {string} options.type 回复类型, 即骨架的一级标题.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 各行.
 */
export function renderReplyGuide({ type, spec }) {
  return wrapGuide([
    `- 回复从下面的 "# ${type}" 写起, 前面不加引导语. 只替换 "${PLACEHOLDER}", 标题, 进展行与选项块原样保留.`,
    conclusionRule(spec.format),
    ...freeformLines(spec.replies[type]),
    ...writingLines(spec.writing),
  ]);
}

/**
 * 给填写要求的各条加上开头 "填写要求:" 与结尾 "骨架:", 其后紧接骨架.
 * reply 与 template 两个命令的输出共用这一格式.
 *
 * @param {readonly string[]} rules 各条要求, 每条一行.
 * @returns {string[]} 各行.
 */
export function wrapGuide(rules) {
  return ["填写要求:", "", ...rules, "", "骨架:", ""];
}

/**
 * 结论行的写法: 用户只读这一行也能知道结果与要做的选择.
 *
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {string} 一条要求.
 */
function conclusionRule(format) {
  return `- "${format.conclusionLabel}:" 一行写给人看: 先说结果, 再说要用户做的选择, 尽量不超过 ${format.conclusionMaxLength} 字, 不铺垫, 不复述. 读者注意力有限, 只读这一行也要能做决定. ${UNIT_RULE}`;
}

/**
 * 回复中自由正文节的写法; 没有自由正文节时为空.
 *
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {string[]} 各行.
 */
function freeformLines(reply) {
  return reply.sections
    .filter(isFreeformSection)
    .map((section) => `- "## ${section.title}" ${FREEFORM_RULE}.`);
}

/**
 * 列出写作建议与禁用词; 只作提醒, 回复结束时不按这些规则打回.
 *
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {string[]} 各行.
 */
function writingLines(writing) {
  const descriptions = describeWritingRules(writing);
  const advised = Object.entries(writing).filter(
    ([key, rule]) =>
      rule.severity === ADVISED_SEVERITY && !FILE_ONLY_RULES.includes(key),
  );
  const conditions = advised
    .filter(([key]) => !WORD_LIST_RULES.includes(key))
    .map(([key]) => descriptions[key]);
  const words = advised
    .filter(([key]) => WORD_LIST_RULES.includes(key))
    .flatMap(([, rule]) => rule.words ?? []);
  return [
    `- 写作建议: 避免${conditions.join("; ")}.`,
    `- 不用这些词: ${words.join(", ")}.`,
  ];
}
