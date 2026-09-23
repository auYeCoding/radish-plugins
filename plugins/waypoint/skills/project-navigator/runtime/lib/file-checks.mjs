/**
 * @file 按模板规格校验 `.navigator/` 下记录文件的结构.
 *
 * 写入前 (PreToolUse) 由守卫调用: Write 直接校验写入内容, Edit 先重建写入后的
 * 全文再校验. 不合格的写入被拒绝, 拒绝理由列出需要修改的地方.
 */

import { checkKeyLines, checkSummary, splitSections } from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
import { PLACEHOLDER } from "./render.mjs";

/**
 * @typedef {object} FileSpec 一种记录文件的规格.
 * @property {string} pattern 相对于项目根目录的路径模式, `*` 匹配一段路径中的任意字符.
 * @property {string} title 一级标题.
 * @property {boolean} [hasProgress] 是否以 "当前进展" 一节开头.
 * @property {import("./spec.mjs").SectionSpec[]} [sections] 固定的节, 按顺序.
 * @property {import("./spec.mjs").SectionSpec[][]} [variants] 多种可选的固定节序列, 满足其一即可.
 * @property {string} [entryPattern] 只追加记录中, 条目标题的正则.
 * @property {string[]} [entryKeys] 每个条目必须依次包含的键.
 * @property {import("./spec.mjs").SectionSpec[]} [closingSections] 条目之后可选的收尾节.
 */

/**
 * 查找与路径匹配的文件规格.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {string} relativePath 以正斜杠分隔的项目相对路径.
 * @returns {FileSpec | undefined} 规格; 不受校验的文件为 undefined.
 */
export function findFileSpec(spec, relativePath) {
  return Object.values(spec.files ?? {}).find((fileSpec) =>
    patternToRegExp(fileSpec.pattern).test(relativePath),
  );
}

/**
 * 校验一个记录文件的全文.
 *
 * @param {object} options 校验参数.
 * @param {string} options.text 文件全文.
 * @param {FileSpec} options.fileSpec 文件规格.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 问题列表; 为空表示合格.
 */
export function checkFile({ text, fileSpec, spec }) {
  const items = parseMarkdown(text);
  const first = items.find(
    (item) => !(item.kind === "text" && item.text.trim() === ""),
  );
  if (
    first?.kind !== "heading" ||
    first.level !== 1 ||
    first.text !== fileSpec.title
  ) {
    return [`第一行必须是一级标题 "# ${fileSpec.title}".`];
  }
  const { leading, sections, trailing } = splitSections(
    items.slice(items.indexOf(first) + 1),
  );
  const problems = [];
  if (leading.length > 0) {
    problems.push("一级标题与第一个二级标题之间不能有其它内容.");
  }
  const progress =
    fileSpec.hasProgress === true
      ? checkProgress(sections, spec)
      : { problems: [], rest: sections };
  problems.push(...progress.problems);
  problems.push(...checkBody(progress.rest, fileSpec));
  if (
    sections.some((section) =>
      section.items.some((item) => item.kind === "block"),
    )
  ) {
    problems.push("节正文中不能出现代码块, 不能贴代码.");
  }
  problems.push(...checkSummary(trailing[trailing.length - 1], spec.format));
  if (trailing.length > 1) {
    problems.push("文件末尾只能有一个人类总结代码块.");
  }
  if (text.includes(PLACEHOLDER)) {
    problems.push(`文件中仍有未填写的 "${PLACEHOLDER}" 标记.`);
  }
  return problems;
}

/**
 * 校验开头的当前进展一节.
 *
 * @param {import("./layout.mjs").Section[]} sections 全部节.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {{problems: string[], rest: import("./layout.mjs").Section[]}} 问题列表与当前进展之后的节.
 */
function checkProgress(sections, spec) {
  const first = sections[0];
  if (first?.title !== spec.format.progressTitle) {
    return {
      problems: [`第一节必须是 "## ${spec.format.progressTitle}".`],
      rest: sections,
    };
  }
  return {
    problems: checkKeyLines(first, spec.format.progressKeys),
    rest: sections.slice(1),
  };
}

/**
 * 校验进展之后的正文各节: 固定节 (或可选序列之一), 以及只追加的条目.
 *
 * @param {import("./layout.mjs").Section[]} sections 正文各节.
 * @param {FileSpec} fileSpec 文件规格.
 * @returns {string[]} 问题列表.
 */
function checkBody(sections, fileSpec) {
  const candidates = fileSpec.variants ?? [fileSpec.sections ?? []];
  const results = candidates.map((fixed) =>
    checkWithFixedSections(sections, fixed, fileSpec),
  );
  return results.find((problems) => problems.length === 0) ?? results[0];
}

/**
 * 按一种固定节序列校验正文.
 *
 * @param {import("./layout.mjs").Section[]} sections 正文各节.
 * @param {import("./spec.mjs").SectionSpec[]} fixed 固定节序列.
 * @param {FileSpec} fileSpec 文件规格.
 * @returns {string[]} 问题列表.
 */
function checkWithFixedSections(sections, fixed, fileSpec) {
  const head = sections.slice(0, fixed.length);
  const expectedTitles = fixed.map((section) => section.title);
  if (
    head.map((section) => section.title).join("|") !== expectedTitles.join("|")
  ) {
    return [
      `二级标题应依次为 ${expectedTitles.map((title) => `"${title}"`).join(", ") || "无固定节"}.`,
    ];
  }
  const problems = fixed.flatMap((sectionSpec, index) =>
    sectionSpec.keys === undefined
      ? []
      : checkKeyLines(head[index], sectionSpec.keys),
  );
  problems.push(...checkEntries(sections.slice(fixed.length), fileSpec));
  return problems;
}

/**
 * 校验固定节之后的条目与收尾节.
 *
 * @param {import("./layout.mjs").Section[]} rest 固定节之后的节.
 * @param {FileSpec} fileSpec 文件规格.
 * @returns {string[]} 问题列表.
 */
function checkEntries(rest, fileSpec) {
  const closing = fileSpec.closingSections ?? [];
  const closingTitles = closing.map((section) => section.title);
  const entryPattern =
    fileSpec.entryPattern === undefined
      ? undefined
      : new RegExp(fileSpec.entryPattern, "u");
  const problems = [];
  let isClosing = false;
  for (const section of rest) {
    const closingIndex = closingTitles.indexOf(section.title);
    if (closingIndex >= 0) {
      isClosing = true;
      const keys = closing[closingIndex].keys;
      if (keys !== undefined) {
        problems.push(...checkKeyLines(section, keys));
      }
    } else if (
      entryPattern === undefined ||
      isClosing ||
      !entryPattern.test(section.title)
    ) {
      problems.push(`多出了不符合规格的二级标题 "## ${section.title}".`);
    } else if (fileSpec.entryKeys !== undefined) {
      problems.push(...checkKeyLines(section, fileSpec.entryKeys));
    }
  }
  return problems;
}

/**
 * 把路径模式转换为正则: `*` 匹配一段路径中的任意字符, 其余字符按原样匹配.
 *
 * @param {string} pattern 路径模式.
 * @returns {RegExp} 正则.
 */
function patternToRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`, "iu");
}
