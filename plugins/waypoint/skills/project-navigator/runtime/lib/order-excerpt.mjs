/**
 * @file 回复中摘录工单内容的节: 规格中标为 `"source": "order"` 的节, 内容取自
 * 当前工单文件的同名节.
 *
 * "工单审阅" 让用户在发布之前看到工单的真实内容, 所以这些节由 reply 命令按工单
 * 文件预填, 回复结束时核对与工单文件逐字一致, 编排会话不能改写或转述. 摘录的
 * 内容属于工单文件, 写作规则在体检中检查, 不在回复结束时打回.
 */

import { KEY_LINE_PATTERN } from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
import { PLACEHOLDER } from "./render.mjs";

/**
 * 节规格中表示 "内容取自当前工单文件" 的来源名.
 * @type {string}
 */
export const ORDER_SOURCE = "order";

/**
 * 二级标题的级别.
 * @type {number}
 */
const SECTION_LEVEL = 2;

/**
 * @typedef {object} SectionBody 一个二级节的正文.
 * @property {number[]} lines 正文各行的行号, 从 1 开始.
 * @property {string[]} texts 正文各行, 去掉首尾空行.
 */

/**
 * 判断回复是否含有摘录工单内容的节.
 *
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {boolean} 含有时返回 true.
 */
export function hasOrderExcerpt(reply) {
  return orderSourceSections(reply).length > 0;
}

/**
 * 按工单文件生成摘录节的正文, 供骨架直接填入. 键值节的键取自工单的同名节;
 * 工单中没有的键取调用方给出的值, 仍没有时留占位标记由编排会话填写.
 *
 * @param {object} options 生成参数.
 * @param {import("./spec.mjs").ReplySpec} options.reply 回复规格.
 * @param {string} options.orderText 工单文件内容.
 * @param {string} options.emptyValue 工单中该节为空时写的值.
 * @param {Readonly<Record<string, string>>} [options.extraValues] 工单中没有的键的取值, 例如工单文件的路径.
 * @returns {Record<string, string[]>} 节标题到正文各行的映射.
 */
export function orderExcerptBodies({
  reply,
  orderText,
  emptyValue,
  extraValues = {},
}) {
  const bodies = readSectionBodies(orderText);
  return Object.fromEntries(
    orderSourceSections(reply).map((section) => {
      const texts = bodies.get(section.title)?.texts ?? [];
      if (section.keys === undefined) {
        return [section.title, texts.length === 0 ? [emptyValue] : texts];
      }
      const values = keyValues(texts);
      return [
        section.title,
        section.keys.map(
          (key) =>
            `- ${key}: ${values.get(key) ?? extraValues[key] ?? PLACEHOLDER}`,
        ),
      ];
    }),
  );
}

/**
 * 核对回复中的摘录节与工单文件一致: 无键名的节逐行一致 (忽略行尾空白),
 * 键值节中工单也有的键取值一致.
 *
 * @param {object} options 核对参数.
 * @param {string} options.text 回复全文.
 * @param {import("./spec.mjs").ReplySpec} options.reply 回复规格.
 * @param {string} options.orderText 工单文件内容.
 * @returns {string[]} 问题列表; 为空表示一致.
 */
export function checkOrderExcerpt({ text, reply, orderText }) {
  const actual = readSectionBodies(text);
  const expected = readSectionBodies(orderText);
  return orderSourceSections(reply).flatMap((section) => {
    const replyTexts = actual.get(section.title)?.texts ?? [];
    const orderTexts = expected.get(section.title)?.texts ?? [];
    const isSame =
      section.keys === undefined
        ? sameLines(replyTexts, orderTexts)
        : sameKeyValues(keyValues(replyTexts), keyValues(orderTexts));
    return isSame
      ? []
      : [
          `"## ${section.title}" 必须与工单文件中的同名一节一致, 不能改写或转述; 请用 reply 命令生成的内容. 工单需要修改时先改工单文件, 再重新取骨架.`,
        ];
  });
}

/**
 * 把回复中摘录节的正文替换为空行, 行号保持不变. 写作规则只检查编排会话在回复中
 * 自己写的文字.
 *
 * @param {string} text 回复全文.
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {string} 替换后的全文.
 */
export function blankOrderExcerpt(text, reply) {
  const bodies = readSectionBodies(text);
  const blanked = new Set(
    orderSourceSections(reply).flatMap(
      (section) => bodies.get(section.title)?.lines ?? [],
    ),
  );
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line, index) => (blanked.has(index + 1) ? "" : line))
    .join("\n");
}

/**
 * 取出回复规格中摘录工单内容的节.
 *
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {import("./spec.mjs").SectionSpec[]} 这些节的规格.
 */
function orderSourceSections(reply) {
  return reply.sections.filter((section) => section.source === ORDER_SOURCE);
}

/**
 * 读取文本中每个二级节的正文: 从标题之后到下一个一级或二级标题, 或第一个代码块
 * 之前为止, 去掉首尾空行. 同名的节只取第一个.
 *
 * @param {string} text Markdown 全文.
 * @returns {Map<string, SectionBody>} 节标题到正文的映射.
 */
function readSectionBodies(text) {
  const items = parseMarkdown(text);
  const bodies = new Map();
  items.forEach((item, index) => {
    if (
      item.kind !== "heading" ||
      item.level !== SECTION_LEVEL ||
      bodies.has(item.text)
    ) {
      return;
    }
    const end = items.findIndex(
      (next, nextIndex) =>
        nextIndex > index &&
        (next.kind === "block" ||
          (next.kind === "heading" && next.level <= SECTION_LEVEL)),
    );
    const body = items
      .slice(index + 1, end === -1 ? items.length : end)
      .filter((entry) => entry.kind === "text");
    bodies.set(item.text, trimBlankLines(body));
  });
  return bodies;
}

/**
 * 去掉首尾的空行.
 *
 * @param {import("./markdown.mjs").TextItem[]} items 正文各行.
 * @returns {SectionBody} 正文.
 */
function trimBlankLines(items) {
  const first = items.findIndex((item) => item.text.trim() !== "");
  const last = items.findLastIndex((item) => item.text.trim() !== "");
  const kept = first === -1 ? [] : items.slice(first, last + 1);
  return {
    lines: kept.map((item) => item.line),
    texts: kept.map((item) => item.text.trimEnd()),
  };
}

/**
 * 从正文各行中读出键值行.
 *
 * @param {readonly string[]} texts 正文各行.
 * @returns {Map<string, string>} 键到取值的映射.
 */
function keyValues(texts) {
  return new Map(
    texts
      .map((text) => KEY_LINE_PATTERN.exec(text))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

/**
 * 判断两组行是否逐行一致.
 *
 * @param {readonly string[]} first 第一组.
 * @param {readonly string[]} second 第二组.
 * @returns {boolean} 一致时返回 true.
 */
function sameLines(first, second) {
  return (
    first.length === second.length &&
    first.every((line, index) => line === second[index])
  );
}

/**
 * 判断回复中的键值与工单一致: 工单中有的每个键, 回复中的取值都相同.
 *
 * @param {Map<string, string>} replyValues 回复中的键值.
 * @param {Map<string, string>} orderValues 工单中的键值.
 * @returns {boolean} 一致时返回 true.
 */
function sameKeyValues(replyValues, orderValues) {
  return [...orderValues].every(
    ([key, value]) => !replyValues.has(key) || replyValues.get(key) === value,
  );
}
