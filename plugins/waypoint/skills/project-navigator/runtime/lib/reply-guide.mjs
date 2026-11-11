/**
 * @file reply 命令在骨架之前给出的填写要求: 版式要点, 按钮与结论行的写法, 以及写作建议.
 *
 * 回复结束时只校验结构 (标题, 结论行, 选项块); 结论的字数与写作规则都是提醒,
 * 不打回. 内容全部由规格生成, 与体检使用同一份阈值与词表.
 */

import { FREEFORM_RULE } from "./freeform-sections.mjs";
import { choiceLead } from "./option-answer.mjs";
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
 * Claude 桌面应用中填写下一步框的工具; 其它环境没有这个工具.
 * @type {string}
 */
export const BUTTON_TOOL = "mcp__ccd_turn__wrap_up";

/**
 * 下一步框的按钮数量上限; 选项恰好这么多项时才做成按钮.
 * @type {number}
 */
export const BUTTON_COUNT = 2;

/**
 * 下一步框中一个按钮的文字长度上限 (字符数).
 * @type {number}
 */
export const BUTTON_LABEL_MAX_LENGTH = 24;

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
 * @param {number} [options.optionSetIndex] 使用第几组选项, 从 0 开始.
 * @returns {string[]} 各行.
 */
export function renderReplyGuide({ type, spec, optionSetIndex = 0 }) {
  const reply = spec.replies[type];
  const kept =
    reply.optionSets.length > 0
      ? "标题, 进展行与选项块原样保留"
      : "标题与进展行原样保留; 这种回复不需要用户选择, 结尾不加选项块";
  return wrapGuide([
    `- 回复从下面的 "# ${type}" 写起, 前面不加引导语. 只替换 "${PLACEHOLDER}", ${kept}.`,
    "- 各节之外不加文字: 补充说明与建议写进已有的节, 没有对应的节就不写. 每项只写结论与必要的依据, 不复述工单与回执.",
    ...buttonLines(reply.optionSets[optionSetIndex]),
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
 * 判断一组选项能否做成应用的按钮: 恰好是按钮数量上限那么多项, 且规格没有关闭.
 *
 * @param {import("./spec.mjs").OptionSetSpec | undefined} optionSet 选项组; 回复没有选项时为 undefined.
 * @returns {boolean} 能做成按钮时返回 true.
 */
export function hasButtons(optionSet) {
  return (
    optionSet !== undefined &&
    optionSet.buttons !== false &&
    optionSet.choices.length === BUTTON_COUNT
  );
}

/**
 * 按钮的写法: 应用提供下一步框时, 把两个选项同时做成按钮, 用户点一下就能回答.
 * 按钮文字是选项的第一个分句, 与打字回复走同一条识别; 选项块仍然保留.
 *
 * @param {import("./spec.mjs").OptionSetSpec | undefined} optionSet 选项组.
 * @returns {string[]} 各行; 不做按钮时为空.
 */
function buttonLines(optionSet) {
  if (optionSet === undefined || !hasButtons(optionSet)) {
    return [];
  }
  const labels = optionSet.choices
    .map((choice) => `"${choiceLead(choice)}"`)
    .join(", ");
  return [
    `- 按钮: 会话的工具中有 \`${BUTTON_TOOL}\` 时, 在回复之前调用它, 把选项同时做成按钮: ask 用一句话问 "${optionSet.title}" 这件事, actions 依次是 label 为 ${labels} 的两项, 不带 action 字段. 选项块照常保留. 没有这个工具时不做按钮, 只用选项块.`,
  ];
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
