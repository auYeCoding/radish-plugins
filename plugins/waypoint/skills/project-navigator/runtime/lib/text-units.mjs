/**
 * @file 字数的算法: 一个汉字, 或一个连续的英文单词, 数字, 路径算 1 个字;
 * 空格与标点不算, 行内代码与网址整体算 1 个字.
 *
 * 句长检查与人类总结的字数上限都用这里的算法, 规则中写的 "字" 只有这一种含义.
 */

/**
 * 字数算法的说明, 写进参考文档与 reply 命令的填写要求.
 * @type {string}
 */
export const UNIT_RULE =
  "字数的算法: 汉字, 英文单词, 数字, 路径各算 1 字, 行内代码与网址整体算 1 字, 空格与标点不算.";

/**
 * 行内代码.
 * @type {RegExp}
 */
const INLINE_CODE_PATTERN = /`[^`]*`/gu;

/**
 * 链接: 只保留链接文字.
 * @type {RegExp}
 */
const LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/gu;

/**
 * 网址.
 * @type {RegExp}
 */
const URL_PATTERN = /https?:\/\/\S+/gu;

/**
 * 行内代码与网址在计数时替换成的记号, 按 1 个字计算.
 * @type {string}
 */
const TOKEN_REPLACEMENT = "X";

/**
 * 计数单位: 一个汉字, 或一个连续的英文单词, 数字, 路径.
 * @type {RegExp}
 */
const COUNTED_UNIT_PATTERN =
  /\p{Script=Han}|[A-Za-z0-9]+(?:[-_./\\][A-Za-z0-9]+)*/gu;

/**
 * 去掉行内代码, 链接地址与网址, 只保留需要检查的文字.
 *
 * @param {string} content 正文.
 * @returns {string} 处理后的文字.
 */
export function plainText(content) {
  return content
    .replace(INLINE_CODE_PATTERN, TOKEN_REPLACEMENT)
    .replace(LINK_PATTERN, "$1")
    .replace(URL_PATTERN, TOKEN_REPLACEMENT);
}

/**
 * 计算已经过 {@link plainText} 处理的文字有多少个字.
 *
 * @param {string} text 文字.
 * @returns {number} 字数.
 */
export function countUnits(text) {
  return text.match(COUNTED_UNIT_PATTERN)?.length ?? 0;
}
