/**
 * @file reply 命令在骨架之前给出的填写要求: 版式要点, 人类总结的字数上限,
 * 以及回复结束时会被打回的写作规则.
 *
 * 要求在填写的时刻出现在模型眼前, 回复结束时的校验只做兜底. 内容全部由规格生成,
 * 与校验使用同一份阈值与词表.
 */

import { PLACEHOLDER } from "./render.mjs";
import { UNIT_RULE } from "./text-units.mjs";
import { describeWritingRules } from "./writing-rules.mjs";

/**
 * 回复结束时会被打回的写作规则级别.
 * @type {string}
 */
const BLOCKING_SEVERITY = "problem";

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
 * 回复结束时会检查写作规则的回复方; 执行会话的回复只检查版式.
 * @type {string}
 */
const WRITING_CHECKED_ROLE = "orchestrator";

/**
 * 生成填写要求, 以 "骨架:" 与一个空行结束, 其后紧接骨架.
 *
 * @param {object} options 生成参数.
 * @param {string} options.type 回复类型, 即骨架的一级标题.
 * @param {"orchestrator" | "executor"} options.role 回复方.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 各行.
 */
export function renderReplyGuide({ type, role, spec }) {
  return [
    "填写要求:",
    "",
    `- 回复从下面的 "# ${type}" 写起, 前面不加引导语. 只替换 "${PLACEHOLDER}", 标题, 键名, 当前进展与选项块原样保留.`,
    `- 人类总结只写结论与要用户做的选择, 不超过 ${spec.format.summaryMaxLength} 字. ${UNIT_RULE}`,
    ...(role === WRITING_CHECKED_ROLE ? writingLines(spec.writing) : []),
    "",
    "骨架:",
    "",
  ];
}

/**
 * 列出回复结束时会被打回的写作规则与禁用词.
 *
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {string[]} 各行.
 */
function writingLines(writing) {
  const descriptions = describeWritingRules(writing);
  const blocking = Object.entries(writing).filter(
    ([key, rule]) =>
      rule.severity === BLOCKING_SEVERITY && !FILE_ONLY_RULES.includes(key),
  );
  const conditions = blocking
    .filter(([key]) => !WORD_LIST_RULES.includes(key))
    .map(([key]) => descriptions[key]);
  const words = blocking
    .filter(([key]) => WORD_LIST_RULES.includes(key))
    .flatMap(([, rule]) => rule.words ?? []);
  return [
    `- 以下情况会被打回: ${conditions.join("; ")}.`,
    `- 不用这些词: ${words.join(", ")}.`,
  ];
}
