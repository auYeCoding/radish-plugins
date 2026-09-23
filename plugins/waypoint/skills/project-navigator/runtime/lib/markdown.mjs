/**
 * @file 把 Markdown 文本切分成标题, 围栏代码块与普通文本行的有序序列.
 *
 * 只实现版式校验需要的 CommonMark 子集: ATX 标题与围栏代码块 (反引号或波浪号,
 * 关闭围栏须使用同一字符且长度不短于开启围栏). 回复校验与文件校验共用这一个解析器.
 */

/**
 * 开启围栏的格式: 最多 3 个空格缩进, 3 个以上反引号或波浪号, 其后为信息串.
 * @type {RegExp}
 */
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/**
 * ATX 标题的格式: 1 至 6 个井号, 空格, 标题文字.
 * @type {RegExp}
 */
const HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/u;

/**
 * @typedef {object} HeadingItem 一个 ATX 标题.
 * @property {"heading"} kind 条目种类.
 * @property {number} level 标题级别, 1 至 6.
 * @property {string} text 标题文字.
 * @property {number} line 所在行号, 从 1 开始.
 */

/**
 * @typedef {object} BlockItem 一个围栏代码块.
 * @property {"block"} kind 条目种类.
 * @property {string} fence 开启围栏的字符序列, 例如三个反引号.
 * @property {string} language 信息串的第一个词, 没有时为空字符串.
 * @property {string[]} content 围栏之间的各行.
 * @property {boolean} isClosed 是否找到了关闭围栏.
 * @property {number} line 开启围栏所在行号, 从 1 开始.
 */

/**
 * @typedef {object} TextItem 围栏之外, 不是标题的一行.
 * @property {"text"} kind 条目种类.
 * @property {string} text 行内容.
 * @property {number} line 行号, 从 1 开始.
 */

/**
 * @typedef {HeadingItem | BlockItem | TextItem} MarkdownItem 解析结果中的一项.
 */

/**
 * 把 Markdown 文本解析成有序条目.
 *
 * @param {string} source Markdown 文本.
 * @returns {MarkdownItem[]} 按出现顺序排列的条目.
 */
export function parseMarkdown(source) {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  /** @type {MarkdownItem[]} */
  const items = [];
  let index = 0;
  while (index < lines.length) {
    const opening = FENCE_OPEN_PATTERN.exec(lines[index]);
    if (opening !== null && isValidOpening(opening)) {
      const block = readBlock(lines, index, opening);
      items.push(block.item);
      index = block.nextIndex;
      continue;
    }
    items.push(toLineItem(lines[index], index + 1));
    index += 1;
  }
  return items;
}

/**
 * 判断匹配到的开启围栏是否有效: 反引号围栏的信息串中不能再含反引号.
 *
 * @param {RegExpExecArray} opening 开启围栏的匹配结果.
 * @returns {boolean} 有效时返回 true.
 */
function isValidOpening(opening) {
  return !(opening[1].startsWith("`") && opening[2].includes("`"));
}

/**
 * 从开启围栏开始读取一个代码块, 直到关闭围栏或文本结束.
 *
 * @param {string[]} lines 全部行.
 * @param {number} startIndex 开启围栏所在下标.
 * @param {RegExpExecArray} opening 开启围栏的匹配结果.
 * @returns {{item: BlockItem, nextIndex: number}} 代码块与其后第一行的下标.
 */
function readBlock(lines, startIndex, opening) {
  const fence = opening[1];
  const closing = new RegExp(
    `^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`,
    "u",
  );
  const content = [];
  let index = startIndex + 1;
  while (index < lines.length && !closing.test(lines[index])) {
    content.push(lines[index]);
    index += 1;
  }
  const isClosed = index < lines.length;
  return {
    item: {
      kind: "block",
      fence,
      language: opening[2].trim().split(/\s+/u)[0] ?? "",
      content,
      isClosed,
      line: startIndex + 1,
    },
    nextIndex: isClosed ? index + 1 : index,
  };
}

/**
 * 把围栏之外的一行转换成标题或文本条目.
 *
 * @param {string} text 行内容.
 * @param {number} line 行号, 从 1 开始.
 * @returns {HeadingItem | TextItem} 条目.
 */
function toLineItem(text, line) {
  const heading = HEADING_PATTERN.exec(text);
  if (heading === null) {
    return { kind: "text", text, line };
  }
  return {
    kind: "heading",
    level: heading[1].length,
    text: heading[2],
    line,
  };
}
