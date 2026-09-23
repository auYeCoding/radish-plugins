/**
 * @file 生成列宽对齐的 Markdown 表格. 汉字与全角字符按 2 列计算宽度,
 * 让表格在源码中也整齐, 与 prettier 的对齐结果一致.
 */

/**
 * 在等宽终端中占 2 列的字符: 汉字, 全角标点与符号.
 * @type {RegExp}
 */
const WIDE_CHARACTER_PATTERN = /[\p{Script=Han}　-〿゠-ヿ＀-￯]/u;

/**
 * 表头分隔行中每列至少使用的连字符数.
 * @type {number}
 */
const MINIMUM_RULE_WIDTH = 3;

/**
 * 计算文字的显示宽度.
 *
 * @param {string} text 文字.
 * @returns {number} 显示宽度.
 */
export function displayWidth(text) {
  return [...text].reduce(
    (width, character) =>
      width + (WIDE_CHARACTER_PATTERN.test(character) ? 2 : 1),
    0,
  );
}

/**
 * 生成列宽对齐的表格.
 *
 * @param {readonly string[]} headers 表头.
 * @param {readonly (readonly string[])[]} rows 各行, 每行的单元格数与表头相同.
 * @returns {string[]} 表格各行.
 */
export function renderTable(headers, rows) {
  const cells = [headers, ...rows].map((row) =>
    row.map((cell) => cell.replaceAll("|", "\\|")),
  );
  const widths = headers.map((_header, column) =>
    Math.max(
      MINIMUM_RULE_WIDTH,
      ...cells.map((row) => displayWidth(row[column] ?? "")),
    ),
  );
  const formatRow = (row) =>
    `| ${row.map((cell, column) => pad(cell, widths[column])).join(" | ")} |`;
  return [
    formatRow(cells[0]),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...cells.slice(1).map((row) => formatRow(row)),
  ];
}

/**
 * 用空格把文字补到指定显示宽度.
 *
 * @param {string} text 文字.
 * @param {number} width 目标宽度.
 * @returns {string} 补齐后的文字.
 */
function pad(text, width) {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}
