/**
 * @file 识别用户对选项块的回答: 回复单独的选项字母, 或以选项文字的第一个分句开头.
 *
 * 开工对齐与工单审阅都要由 hook 记下用户是否选了 A; 识别的文字取自规格中的
 * 选项, 与回复中显示的选项保持一致.
 */

import { OPTION_LETTERS } from "./render.mjs";

/**
 * 选项文字中分句的分隔符, 取第一个分句作为可识别的写法.
 * @type {RegExp}
 */
const CLAUSE_BREAK_PATTERN = /[,.;:]/u;

/**
 * 判断用户消息是否选了某组选项中的某一项.
 *
 * @param {string} prompt 用户消息.
 * @param {import("./spec.mjs").OptionSetSpec} optionSet 选项组.
 * @param {number} index 选项下标, 从 0 开始.
 * @returns {boolean} 选了该项时返回 true.
 */
export function isChoiceSelected(prompt, optionSet, index) {
  const letter = OPTION_LETTERS[index];
  const choice = optionSet.choices[index];
  if (letter === undefined || choice === undefined) {
    return false;
  }
  const trimmed = prompt.trim();
  const letterPattern = new RegExp(
    `^[${letter}${letter.toLowerCase()}](?:[\\s.,:;)]|$)`,
    "u",
  );
  const lead = choice.split(CLAUSE_BREAK_PATTERN)[0].trim();
  return (
    letterPattern.test(trimmed) || (lead !== "" && trimmed.startsWith(lead))
  );
}
