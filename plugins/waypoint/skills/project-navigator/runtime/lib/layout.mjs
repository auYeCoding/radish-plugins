/**
 * @file 回复与文件共用的版式工具: 按二级标题切节, 校验键值节, 识别总结块.
 *
 * 回复校验 (reply-checks) 与文件校验 (file-checks) 都建立在这里的函数之上,
 * 保证两边对 "节", "键值行" 与 "人类总结" 的理解完全一致.
 */

import { countUnits, plainText } from "./text-units.mjs";

/**
 * 键值行的格式: "- 键名: 值".
 * @type {RegExp}
 */
export const KEY_LINE_PATTERN = /^- (\S+?): (.+)$/u;

/**
 * @typedef {object} Section 一个二级节.
 * @property {string} title 节标题.
 * @property {import("./markdown.mjs").MarkdownItem[]} items 节内条目, 不含空行.
 */

/**
 * @typedef {object} SplitResult 切节结果.
 * @property {import("./markdown.mjs").MarkdownItem[]} leading 一级标题之后, 第一个二级标题之前的条目.
 * @property {Section[]} sections 各节.
 * @property {import("./markdown.mjs").BlockItem[]} trailing 最后一节末尾连续的代码块.
 */

/**
 * 去掉空行后, 按二级标题切节; 末尾连续的代码块单独取出 (没有任何节时,
 * 从一级标题之后的内容末尾取出).
 *
 * @param {import("./markdown.mjs").MarkdownItem[]} items 一级标题之后的条目.
 * @returns {SplitResult} 切节结果.
 */
export function splitSections(items) {
  const leading = [];
  /** @type {Section[]} */
  const sections = [];
  for (const item of items) {
    if (item.kind === "text" && item.text.trim() === "") {
      continue;
    }
    if (item.kind === "heading" && item.level === 2) {
      sections.push({ title: item.text, items: [] });
    } else if (sections.length === 0) {
      leading.push(item);
    } else {
      sections[sections.length - 1].items.push(item);
    }
  }
  const container =
    sections.length === 0 ? leading : sections[sections.length - 1].items;
  const start = trailingBlockStart(container);
  const trailing =
    start < 0
      ? []
      : /** @type {import("./markdown.mjs").BlockItem[]} */ (
          container.splice(start)
        );
  return { leading, sections, trailing };
}

/**
 * 校验键值节: 只含规格中的键值行, 顺序一致.
 *
 * @param {Section} section 节.
 * @param {readonly string[]} keys 规格中的键名.
 * @returns {string[]} 问题列表.
 */
export function checkKeyLines(section, keys) {
  const actualKeys = section.items.map((item) =>
    item.kind === "text" ? KEY_LINE_PATTERN.exec(item.text)?.[1] : undefined,
  );
  const isMatch =
    actualKeys.length === keys.length &&
    actualKeys.every((key, index) => key === keys[index]);
  return isMatch
    ? []
    : [
        `"## ${section.title}" 应依次包含 ${keys.map((key) => `"- ${key}: 值"`).join(", ")}, 每行一个, 不加其它内容.`,
      ];
}

/**
 * 判断代码块是否为人类总结块.
 *
 * @param {import("./markdown.mjs").BlockItem} block 代码块.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {boolean} 是总结块时返回 true.
 */
export function isSummaryBlock(block, format) {
  return (
    block.language === format.summaryLanguage &&
    block.content[0] === format.summarySeparator
  );
}

/**
 * 校验结尾的人类总结: 必须存在, 位于最后, 正文不为空且不超过字数上限.
 *
 * @param {import("./markdown.mjs").BlockItem | undefined} block 最后一个代码块.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {string[]} 问题列表.
 */
export function checkSummary(block, format) {
  if (block === undefined || !isSummaryBlock(block, format)) {
    return [
      `最后一个代码块必须是人类总结: 语言标记为 ${format.summaryLanguage}, 首行为 "${format.summarySeparator}".`,
    ];
  }
  const body = block.content.slice(1).join("\n").trim();
  if (body === "") {
    return ["人类总结不能为空."];
  }
  const length = countUnits(plainText(body));
  return length > format.summaryMaxLength
    ? [`人类总结共 ${length} 字, 超过 ${format.summaryMaxLength} 字上限.`]
    : [];
}

/**
 * 找到条目列表末尾连续代码块的起点.
 *
 * @param {import("./markdown.mjs").MarkdownItem[]} items 条目.
 * @returns {number} 起点下标; 末尾没有代码块时为 -1.
 */
function trailingBlockStart(items) {
  let start = items.length;
  while (start > 0 && items[start - 1].kind === "block") {
    start -= 1;
  }
  return start === items.length ? -1 : start;
}
