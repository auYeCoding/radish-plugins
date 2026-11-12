/**
 * @file 识别用户对选项块的回答: 回复单独的选项字母, 或以选项文字的第一个分句开头.
 *
 * 开工对齐与工单审阅都要由 hook 记下用户是否选了 A; 识别的文字取自规格中的
 * 选项, 与回复中显示的选项保持一致. 支持按钮的应用中, 按钮文字就是选项的
 * 第一个分句, 点按钮与打字回复走同一条识别.
 */

import { OPTION_LETTERS } from "./render.mjs";

/**
 * 选项文字中分句的分隔符, 取第一个分句作为可识别的写法.
 * @type {RegExp}
 */
const CLAUSE_BREAK_PATTERN = /[,.;:]/u;

/**
 * 取出选项文字的第一个分句, 例如 "发布工单, 开始执行." 得到 "发布工单".
 * 用户以这个分句开头的回复算选了该项, 应用的按钮也用它作文字.
 *
 * @param {string} choice 选项文字.
 * @returns {string} 第一个分句.
 */
export function choiceLead(choice) {
  return choice.split(CLAUSE_BREAK_PATTERN)[0].trim();
}

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
  const letterPattern = new RegExp(
    `^[${letter}${letter.toLowerCase()}](?:[\\s.,:;)]|$)`,
    "u",
  );
  return (
    letterPattern.test(prompt.trim()) || isChoiceNamed(prompt, optionSet, index)
  );
}

/**
 * 判断用户消息是否以某一项选项文字的第一个分句开头. 选项字母在每条回复中都有,
 * 只有紧跟着那条回复时才指向这一项; 选项文字本身说明了用户要做什么, 隔了几条
 * 消息之后仍然有效.
 *
 * @param {string} prompt 用户消息.
 * @param {import("./spec.mjs").OptionSetSpec} optionSet 选项组.
 * @param {number} index 选项下标, 从 0 开始.
 * @returns {boolean} 以该项的第一个分句开头时返回 true.
 */
export function isChoiceNamed(prompt, optionSet, index) {
  const choice = optionSet.choices[index];
  if (choice === undefined) {
    return false;
  }
  const lead = choiceLead(choice);
  return lead !== "" && prompt.trim().startsWith(lead);
}
