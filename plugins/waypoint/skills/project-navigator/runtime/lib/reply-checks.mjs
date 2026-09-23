/**
 * @file 按模板规格校验回复版式.
 *
 * 回复结束时 Stop hook 调用这里的检查; 返回的问题列表直接作为打回原因交给模型,
 * 所以每条问题都写成可以照着改的中文句子.
 */

import {
  KEY_LINE_PATTERN,
  checkKeyLines,
  checkSummary,
  isSummaryBlock,
  splitSections,
} from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
import { PLACEHOLDER, progressValues } from "./render.mjs";
import { findReply } from "./spec.mjs";

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
 * 校验一条回复, 返回发现的问题.
 *
 * @param {object} options 校验参数.
 * @param {string} options.text 回复全文.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {import("./state.mjs").NavigatorState | undefined} options.state 当前状态, 用于核对进展.
 * @param {"orchestrator" | "executor"} options.role 回复方.
 * @returns {string[]} 问题列表; 为空表示合格.
 */
export function checkReply({ text, spec, state, role }) {
  const { preface, heading, body } = locateReply(text);
  if (heading === undefined) {
    return ['回复必须以一级标题写明回复类型, 例如 "# 首次接入".'];
  }
  const reply = findReply(spec, heading.text);
  if (reply === undefined || reply.role !== role) {
    return [`一级标题 "${heading.text}" 不是允许的回复类型.`];
  }
  const split = splitSections(body);
  const { sections, trailing } = reattachSectionBlocks(
    split.sections,
    split.trailing,
    spec.format,
  );
  const leading = split.leading;
  const problems = [];
  if (preface.some((item) => item.kind !== "text")) {
    problems.push(
      `一级标题 "# ${heading.text}" 之前只能写一句过程说明, 不能有代码块或其它标题.`,
    );
  }
  if (leading.length > 0) {
    problems.push(
      `一级标题与 "## ${spec.format.progressTitle}" 之间不能有其它内容.`,
    );
  }
  problems.push(...checkSections(sections, reply, spec, state));
  problems.push(...checkTrailingBlocks(trailing, reply, spec));
  if (text.includes(PLACEHOLDER)) {
    problems.push(`回复中仍有未填写的 "${PLACEHOLDER}" 标记.`);
  }
  return problems;
}

/**
 * 把结尾代码块中位于选项块与总结块之前的部分 (例如启动提示词) 归还给最后一节,
 * 由节的规则判断是否允许.
 *
 * @param {import("./layout.mjs").Section[]} sections 各节.
 * @param {import("./markdown.mjs").BlockItem[]} trailing 最后一节末尾连续的代码块.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {{sections: import("./layout.mjs").Section[], trailing: import("./markdown.mjs").BlockItem[]}} 调整后的节与结尾代码块.
 */
function reattachSectionBlocks(sections, trailing, format) {
  const start = trailing.findIndex(
    (block) => isOptionBlock(block) || isSummaryBlock(block, format),
  );
  if (start <= 0 || sections.length === 0) {
    return { sections, trailing };
  }
  const last = sections[sections.length - 1];
  return {
    sections: [
      ...sections.slice(0, -1),
      { ...last, items: [...last.items, ...trailing.slice(0, start)] },
    ],
    trailing: trailing.slice(start),
  };
}

/**
 * 校验各节: 第一节是当前进展, 之后的节与规格一致, 节中不出现未允许的代码块.
 *
 * @param {import("./layout.mjs").Section[]} sections 各节.
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {import("./state.mjs").NavigatorState | undefined} state 当前状态.
 * @returns {string[]} 问题列表.
 */
function checkSections(sections, reply, spec, state) {
  const expected = [
    { title: spec.format.progressTitle, keys: spec.format.progressKeys },
    ...reply.sections,
  ];
  const actualTitles = sections.map((section) => section.title);
  const expectedTitles = expected.map((section) => section.title);
  if (actualTitles.join("|") !== expectedTitles.join("|")) {
    return [
      `二级标题应依次为 ${expectedTitles.map((title) => `"${title}"`).join(", ")}, 实际为 ${actualTitles.map((title) => `"${title}"`).join(", ") || "无"}.`,
    ];
  }
  const problems = [];
  expected.forEach((sectionSpec, index) => {
    const section = sections[index];
    if (
      section.items.some((item) => !isAllowedInSection(item, sectionSpec, spec))
    ) {
      problems.push(
        `"## ${section.title}" 中不能出现代码块, 不能贴代码; 代码块只能是规定的几种.`,
      );
    }
    if (sectionSpec.keys !== undefined) {
      problems.push(...checkKeyLines(section, sectionSpec.keys));
    }
  });
  problems.push(...checkProgressValues(sections[0], spec, state));
  return problems;
}

/**
 * 判断节中的条目是否允许出现: 代码块只在允许启动提示词的节中出现, 且语言标记正确.
 *
 * @param {import("./markdown.mjs").MarkdownItem} item 条目.
 * @param {import("./spec.mjs").SectionSpec} sectionSpec 节规格.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {boolean} 允许时返回 true.
 */
function isAllowedInSection(item, sectionSpec, spec) {
  if (item.kind !== "block") {
    return true;
  }
  return (
    sectionSpec.allowLaunchPrompt === true &&
    item.language === spec.format.launchPromptLanguage
  );
}

/**
 * 核对当前进展的值与脚本根据状态计算的结果一致.
 *
 * @param {import("./layout.mjs").Section} section 当前进展节.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {import("./state.mjs").NavigatorState | undefined} state 当前状态.
 * @returns {string[]} 问题列表.
 */
function checkProgressValues(section, spec, state) {
  const expected = progressValues(state, spec);
  const problems = [];
  section.items.forEach((item, index) => {
    const match =
      item.kind === "text" ? KEY_LINE_PATTERN.exec(item.text) : null;
    if (
      match !== null &&
      expected[index] !== undefined &&
      match[2] !== expected[index]
    ) {
      problems.push(
        `"${match[1]}" 应为 "${expected[index]}", 请用 reply 命令生成的进展原样填写.`,
      );
    }
  });
  return problems;
}

/**
 * 校验结尾代码块: 恰好一个选项块与一个人类总结块, 且总结块在最后.
 *
 * @param {import("./markdown.mjs").BlockItem[]} blocks 结尾的代码块.
 * @param {import("./spec.mjs").ReplySpec} reply 回复规格.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 问题列表.
 */
function checkTrailingBlocks(blocks, reply, spec) {
  const summary = blocks[blocks.length - 1];
  const problems = checkSummary(summary, spec.format);
  const optionBlocks = blocks.filter((block) => isOptionBlock(block));
  if (optionBlocks.length !== 1) {
    problems.push("回复结尾必须恰好有一个选项块, 放在人类总结之前.");
  } else {
    problems.push(...checkOptionSet(optionBlocks[0], reply));
  }
  const unexpected = blocks.filter(
    (block) => !isOptionBlock(block) && !isSummaryBlock(block, spec.format),
  );
  if (unexpected.length > 0) {
    problems.push("回复中只能出现规定的代码块, 不能贴代码或其它内容.");
  }
  if (blocks.some((block) => !block.isClosed)) {
    problems.push("有代码块缺少关闭围栏.");
  }
  return problems;
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
