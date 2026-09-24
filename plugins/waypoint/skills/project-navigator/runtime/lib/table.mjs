/**
 * @file 生成与解析 Markdown 表格. 生成时汉字与全角字符按 2 列计算宽度,
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
 * 表格行的格式: 以竖线开头.
 * @type {RegExp}
 */
const TABLE_ROW_PATTERN = /^\s*\|/u;

/**
 * 表头分隔行中一格的格式: 连字符, 两侧可带表示对齐的冒号.
 * @type {RegExp}
 */
const SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/u;

/**
 * 单元格之间的分隔符: 没有被反斜杠转义的竖线.
 * @type {RegExp}
 */
const CELL_SEPARATOR_PATTERN = /(?<!\\)\|/u;

/**
 * @typedef {object} ParsedTable 解析出的表格.
 * @property {string[]} headers 表头各列.
 * @property {string[][]} rows 各行的单元格, 已去掉首尾空白并还原转义的竖线.
 */

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
 * 从若干行文字中解析第一个表格: 连续的竖线开头的行, 第二行必须是表头分隔行.
 *
 * @param {readonly string[]} lines 文字各行.
 * @returns {ParsedTable | undefined} 表格; 没有合法表格时为 undefined.
 */
export function parseTable(lines) {
  const start = lines.findIndex((line) => TABLE_ROW_PATTERN.test(line));
  if (start < 0) {
    return undefined;
  }
  let end = start;
  while (end < lines.length && TABLE_ROW_PATTERN.test(lines[end])) {
    end += 1;
  }
  const [headers, separator, ...rows] = lines.slice(start, end).map(splitRow);
  if (
    separator === undefined ||
    !separator.every((cell) => SEPARATOR_CELL_PATTERN.test(cell))
  ) {
    return undefined;
  }
  return { headers, rows };
}

/**
 * 把一行表格拆成单元格.
 *
 * @param {string} line 表格行.
 * @returns {string[]} 单元格.
 */
function splitRow(line) {
  const inner = line
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "");
  return inner
    .split(CELL_SEPARATOR_PATTERN)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
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
