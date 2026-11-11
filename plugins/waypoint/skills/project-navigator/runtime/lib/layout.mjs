/**
 * @file 回复与文件共用的版式工具: 按二级标题切节, 校验键值节与表格节.
 *
 * 回复校验 (reply-checks), 文件校验 (file-checks) 与读取记录的模块都建立在这里的
 * 函数之上, 保证各处对 "节", "键值行" 与 "表格" 的理解完全一致.
 */

import { parseMarkdown } from "./markdown.mjs";
import { parseTable } from "./table.mjs";

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
 * 在 Markdown 全文中找出某个二级节.
 *
 * @param {string} text Markdown 全文.
 * @param {string} title 节标题.
 * @returns {Section | undefined} 节; 没有该节时为 undefined.
 */
export function findSection(text, title) {
  return splitSections(parseMarkdown(text)).sections.find(
    (section) => section.title === title,
  );
}

/**
 * 读取节中的键值行, 不是键值行的条目忽略.
 *
 * @param {Section} section 节.
 * @returns {Record<string, string>} 键名到值的映射.
 */
export function readKeyValues(section) {
  return Object.fromEntries(
    section.items
      .map((item) =>
        item.kind === "text" ? KEY_LINE_PATTERN.exec(item.text) : null,
      )
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

/**
 * 读取节中的第一个表格.
 *
 * @param {Section} section 节.
 * @returns {import("./table.mjs").ParsedTable | undefined} 表格; 节中没有合法表格时为 undefined.
 */
export function readSectionTable(section) {
  return parseTable(
    section.items.map((item) => (item.kind === "text" ? item.text : "")),
  );
}

/**
 * 校验表格节: 表头与规格一致, 至少一行 (规格允许为空的表格除外), 每格都已填写,
 * 固定取值的列只用允许的值.
 *
 * @param {Section} section 节.
 * @param {import("./spec.mjs").TableSpec} table 表格规格.
 * @returns {string[]} 问题列表.
 */
export function checkTable(section, table) {
  const parsed = readSectionTable(section);
  const title = `"## ${section.title}"`;
  if (
    parsed === undefined ||
    parsed.headers.join("|") !== table.columns.join("|")
  ) {
    return [
      `${title} 应包含一个表格, 表头依次为 ${table.columns.map((column) => `"${column}"`).join(", ")}.`,
    ];
  }
  if (parsed.rows.length === 0 && table.allowEmpty !== true) {
    return [`${title} 的表格至少要有一行内容.`];
  }
  return parsed.rows.flatMap((row, index) =>
    checkTableRow({ row, rowNumber: index + 1, table, title }),
  );
}

/**
 * 校验表格的一行.
 *
 * @param {object} options 校验参数.
 * @param {string[]} options.row 该行的单元格.
 * @param {number} options.rowNumber 行号, 从 1 开始, 不含表头.
 * @param {import("./spec.mjs").TableSpec} options.table 表格规格.
 * @param {string} options.title 用于报告的节标题.
 * @returns {string[]} 问题列表.
 */
function checkTableRow({ row, rowNumber, table, title }) {
  if (row.length !== table.columns.length || row.some((cell) => cell === "")) {
    return [
      `${title} 的表格第 ${rowNumber} 行应有 ${table.columns.length} 格, 每格都要填写.`,
    ];
  }
  return table.columns.flatMap((column, index) => {
    const allowed = table.choices?.[column];
    return allowed === undefined || allowed.includes(row[index])
      ? []
      : [
          `${title} 的表格第 ${rowNumber} 行 "${column}" 只能是 ${allowed.join(", ")} 之一, 不能写 "${row[index]}".`,
        ];
  });
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
