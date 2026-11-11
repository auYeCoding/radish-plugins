/**
 * @file 按模板规格校验回复的结构.
 *
 * 回复结束时 Stop hook 调用这里的检查, 只查机器依赖的结构: 一级标题是回复类型
 * (据此识别回复), 标题下方有结论行, 选项块与规格逐字一致 (据此识别用户的选择),
 * 不需要用户选择的回复不带选项块, 代码块都已关闭, 没有残留占位标记. 节, 键名与写作规则都只是填写要求中的提醒,
 * 不在这里打回. 返回的问题列表直接作为打回原因交给模型.
 */

import { parseMarkdown } from "./markdown.mjs";
import { PLACEHOLDER } from "./render.mjs";
import { findReply, isFreeformSection } from "./spec.mjs";

/**
 * 选项行的格式: "A. 选项文字".
 * @type {RegExp}
 */
const OPTION_LINE_PATTERN = /^([A-H])\. (.+)$/u;

/**
 * 选项块首行的格式: "[标题]".
 * @type {RegExp}
 */
const OPTION_TITLE_PATTERN = /^\[(.+)\]$/u;

/**
 * @typedef {object} LocatedReply 回复在全文中的位置.
 * @property {import("./markdown.mjs").MarkdownItem[]} preface 第一个一级标题之前的非空条目.
 * @property {import("./markdown.mjs").HeadingItem | undefined} heading 第一个一级标题; 没有时为 undefined.
 * @property {import("./markdown.mjs").MarkdownItem[]} body 第一个一级标题之后的非空条目.
 */

/**
 * 在全文中找出回复: 回复从第一个一级标题开始. 模型常在标题前加一句过程说明,
 * 这部分不算回复内容; 打回它只会让用户看到两遍同样的回复.
 *
 * @param {string} text 回复全文.
 * @returns {LocatedReply} 回复的位置.
 */
export function locateReply(text) {
  const items = parseMarkdown(text).filter(
    (item) => !(item.kind === "text" && item.text.trim() === ""),
  );
  const start = items.findIndex(
    (item) => item.kind === "heading" && item.level === 1,
  );
  if (start === -1) {
    return { preface: items, heading: undefined, body: [] };
  }
  return {
    preface: items.slice(0, start),
    heading: /** @type {import("./markdown.mjs").HeadingItem} */ (items[start]),
    body: items.slice(start + 1),
  };
}

/**
 * 校验一条回复的结构, 返回发现的问题.
 *
 * @param {object} options 校验参数.
 * @param {string} options.text 回复全文.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 问题列表; 为空表示合格.
 */
export function checkReply({ text, spec }) {
  const { preface, heading, body } = locateReply(text);
  if (heading === undefined) {
    return ['回复必须以一级标题写明回复类型, 例如 "# 首次接入".'];
  }
  const reply = findReply(spec, heading.text);
  if (reply === undefined) {
    return [`一级标题 "${heading.text}" 不是允许的回复类型.`];
  }
  const blocks = body.filter((item) => item.kind === "block");
  const optionBlocks = blocks.filter((block) => isOptionBlock(block));
  const problems = [];
  if (preface.some((item) => item.kind !== "text")) {
    problems.push(
      `一级标题 "# ${heading.text}" 之前只能写一句过程说明, 不能有代码块或其它标题.`,
    );
  }
  problems.push(...checkConclusion(body[0], spec.format));
  problems.push(...checkOptionBlocks(optionBlocks, reply));
  if (!reply.sections.some(isFreeformSection)) {
    const stray = blocks.filter((block) => !isOptionBlock(block));
    if (stray.length > 0) {
      problems.push("回复中只能有选项块一个代码块, 不能贴代码.");
    }
  }
  if (blocks.some((block) => !block.isClosed)) {
    problems.push("有代码块缺少关闭围栏.");
  }
  if (text.includes(PLACEHOLDER)) {
    problems.push(`回复中仍有未填写的 "${PLACEHOLDER}" 标记.`);
  }
  return problems;
}

/**
 * 校验一级标题之后的第一行是结论行, 且结论不为空.
 *
 * @param {import("./markdown.mjs").MarkdownItem | undefined} first 一级标题之后的第一个非空条目.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {string[]} 问题列表.
 */
function checkConclusion(first, format) {
  const prefix = `${format.conclusionLabel}: `;
  const isConclusion =
    first?.kind === "text" &&
    first.text.startsWith(prefix) &&
    first.text.slice(prefix.length).trim() !== "";
  return isConclusion
    ? []
    : [
        `一级标题下方第一行必须是结论行 "${prefix}<一句话结论>", 写给人看, 先说结果与要用户做的选择.`,
      ];
}

/**
 * 判断代码块是否为选项块: 无语言标记, 首行为方括号标题.
 *
 * @param {import("./markdown.mjs").BlockItem} block 代码块.
 * @returns {boolean} 是选项块时返回 true.
 */
function isOptionBlock(block) {
  return (
    block.language === "" && OPTION_TITLE_PATTERN.test(block.content[0] ?? "")
  );
}

/**
 * 校验选项块的数量: 规格中有选项组的回复恰好一个, 且与某一组一致; 没有选项组的
 * 回复不需要用户选择, 不能带选项块.
 *
 * @param {import("./markdown.mjs").BlockItem[]} optionBlocks 回复中的选项块.
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {string[]} 问题列表.
 */
function checkOptionBlocks(optionBlocks, reply) {
  if (reply.optionSets.length === 0) {
    return optionBlocks.length === 0
      ? []
      : ["这种回复不需要用户选择, 不能带选项块."];
  }
  return optionBlocks.length === 1
    ? checkOptionSet(optionBlocks[0], reply)
    : ["回复结尾必须恰好有一个选项块."];
}

/**
 * 校验选项块与规格中的某一组选项完全一致.
 *
 * @param {import("./markdown.mjs").BlockItem} block 选项块.
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {string[]} 问题列表.
 */
function checkOptionSet(block, reply) {
  const title = OPTION_TITLE_PATTERN.exec(block.content[0])?.[1];
  const choices = block.content
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => OPTION_LINE_PATTERN.exec(line)?.[2]);
  const isMatch = reply.optionSets.some(
    (set) =>
      set.title === title &&
      set.choices.length === choices.length &&
      set.choices.every((choice, index) => choice === choices[index]),
  );
  return isMatch
    ? []
    : ["选项块必须与规格中的固定选项逐字一致, 请用 reply 命令生成的选项块."];
}
