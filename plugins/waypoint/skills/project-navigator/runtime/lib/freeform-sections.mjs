/**
 * @file 回复中的自由正文节: 规格中标为 `"freeform": true` 的节.
 *
 * 用户要求流程之外的内容 (例如解释, 或写给维护者的报告) 时, 编排会话用 "自由答复"
 * 回复. 自由正文按用户要求的格式撰写, 可以放代码块与三级及以下的标题; 二级标题会被
 * 当成新的一节, 所以不能用. 自由正文不按回复的写作规则打回, 版式校验仍然核对当前
 * 进展, 选项块与人类总结.
 */

import { splitSections } from "./layout.mjs";
import { blankLines } from "./markdown.mjs";
import { locateReply } from "./reply-checks.mjs";
import { isFreeformSection } from "./spec.mjs";

/**
 * 自由正文的写法, 填写要求与参考文档共用.
 * @type {string}
 */
export const FREEFORM_RULE =
  "按用户要求的格式撰写, 可以放代码块与三级及以下的标题, 不能用一级与二级标题, 不按写作规则打回";

/**
 * 判断回复是否含有自由正文节.
 *
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {boolean} 含有时返回 true.
 */
export function hasFreeformSection(reply) {
  return reply.sections.some(isFreeformSection);
}

/**
 * 把回复中自由正文节的文字行替换为空行, 行号保持不变. 代码块不参加写作规则检查,
 * 保留原样, 以免结尾的选项块与人类总结被误删.
 *
 * @param {string} text 回复全文.
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @returns {string} 替换后的全文.
 */
export function blankFreeformSections(text, reply) {
  const titles = new Set(
    reply.sections.filter(isFreeformSection).map((section) => section.title),
  );
  if (titles.size === 0) {
    return text;
  }
  const lines = splitSections(locateReply(text).body)
    .sections.filter((section) => titles.has(section.title))
    .flatMap((section) => section.items)
    .filter((item) => item.kind !== "block")
    .map((item) => item.line);
  return blankLines(text, new Set(lines));
}
