/**
 * @file 用户测试记录: 用户亲手运行测试后粘贴给编排会话的原始输出.
 *
 * 编排会话把输出写进工单文件夹中的记录, 验收子代理按输出判定判据. 写入前核对
 * 每段新写入的输出都逐字出现在编排会话最近收到的用户消息中, 防止编排会话改写
 * 输出. 用户用 `!` 运行的命令不经过 "用户发消息" 事件, 其输出需要用户粘贴.
 */

import { parseMarkdown } from "./markdown.mjs";

/**
 * 用户测试记录在规格 files 中的种类名.
 * @type {string}
 */
export const USER_TESTS_FILE_KIND = "user-tests";

/**
 * 报告不一致的输出时, 每段输出摘录的最大字符数.
 * @type {number}
 */
const EXCERPT_LENGTH = 40;

/**
 * 找出新写入的输出中不合格的: 为空, 或没有逐字出现在用户最近的消息中.
 * 写入之前已在文件中的输出不再核对, 它们在当初写入时已经核对过.
 *
 * @param {object} options 核对参数.
 * @param {string} options.content 写入后的文件全文.
 * @param {string | undefined} options.previous 写入前的文件全文; 新建时为 undefined.
 * @param {readonly string[]} options.prompts 编排会话最近收到的用户消息.
 * @param {string} options.language 输出代码块的语言标记.
 * @returns {string[]} 问题列表; 为空表示全部合格.
 */
export function checkUserOutputs({ content, previous, prompts, language }) {
  const known = new Set(outputBlocks(previous ?? "", language));
  const sources = prompts.map(normalizeOutput);
  return outputBlocks(content, language)
    .filter((output) => !known.has(output))
    .flatMap((output) => {
      if (output === "") {
        return ["输出代码块不能为空."];
      }
      return sources.some((source) => source.includes(output))
        ? []
        : [
            `输出 "${output.slice(0, EXCERPT_LENGTH)}" 没有逐字出现在用户最近的消息中. 请用户把完整输出粘贴成一条消息 (用 ! 运行的命令, 其输出守卫看不到), 再原样写入.`,
          ];
    });
}

/**
 * 取出文件中全部输出代码块的内容, 已统一换行与行尾空白.
 *
 * @param {string} text 文件全文.
 * @param {string} language 输出代码块的语言标记.
 * @returns {string[]} 各段输出.
 */
function outputBlocks(text, language) {
  return parseMarkdown(text)
    .filter((item) => item.kind === "block" && item.language === language)
    .map((item) =>
      normalizeOutput(
        /** @type {import("./markdown.mjs").BlockItem} */ (item).content.join(
          "\n",
        ),
      ),
    );
}

/**
 * 统一换行符, 去掉行尾空白与首尾空行, 避免终端与编辑器的差异造成误报.
 *
 * @param {string} text 原文.
 * @returns {string} 统一后的文字.
 */
function normalizeOutput(text) {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
