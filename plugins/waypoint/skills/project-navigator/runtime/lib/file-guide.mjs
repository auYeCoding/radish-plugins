/**
 * @file template 命令在骨架之前给出的填写要求: 标题与键名的保留, 键值节与表格节的
 * 写法, 代码块与人类总结.
 *
 * 写入时的结构校验 (file-checks) 只在写入被拦下时才让模型看到规则; 要求在填写的时刻
 * 给出, 校验只做兜底. 内容全部由文件规格生成, 与校验使用同一份规格.
 */

import { PLACEHOLDER } from "./render.mjs";
import { summaryRule, wrapGuide } from "./reply-guide.mjs";

/**
 * 键值节的写法. 写入校验要求键值节只含规格中的键值行, 模型常在键下面接表格或
 * 列表; 参考文档与执行手册也引用这一句.
 * @type {string}
 */
export const KEY_SECTION_RULE =
  '键值节中每个键只占一行 "- 键名: 值", 值写在同一行, 节中不加其它行, 列表, 表格或段落';

/**
 * 生成记录文件的填写要求, 以 "骨架:" 与一个空行结束, 其后紧接骨架.
 *
 * @param {object} options 生成参数.
 * @param {import("./file-checks.mjs").FileSpec} options.fileSpec 文件规格.
 * @param {readonly import("./spec.mjs").SectionSpec[]} options.sections 骨架使用的固定节序列.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 各行.
 */
export function renderFileGuide({ fileSpec, sections, spec }) {
  return wrapGuide([
    `- 文件从下面的 "# ${fileSpec.title}" 写起. 只替换 "${PLACEHOLDER}", 标题与键名原样保留, 不增删二级标题.`,
    ...keySectionLines(sections),
    ...sections
      .filter((section) => section.table !== undefined)
      .map(tableSectionLine),
    ...entryLines(fileSpec),
    `- 节正文中不放代码块${fileSpec.entryBlock === undefined ? "" : ` (条目末尾的 ${fileSpec.entryBlock} 输出块除外)`}, 不贴代码.`,
    summaryRule(spec.format),
  ]);
}

/**
 * 键值节的写法, 并指出多行内容可以放在哪些没有键名的节.
 *
 * @param {readonly import("./spec.mjs").SectionSpec[]} sections 固定节序列.
 * @returns {string[]} 各条要求; 没有键值节时为空.
 */
function keySectionLines(sections) {
  const keyed = sections.filter((section) => section.keys !== undefined);
  if (keyed.length === 0) {
    return [];
  }
  const free = sections.filter(
    (section) => section.keys === undefined && section.table === undefined,
  );
  const overflow =
    free.length === 0
      ? ""
      : `, 表格与多行内容写进没有键名的节 (${free.map((section) => `"${section.title}"`).join(", ")})`;
  return [
    `- ${KEY_SECTION_RULE}. 键值节: ${keyed.map((section) => `"${section.title}"`).join(", ")}. 内容多时在一行内用分号分隔${overflow}.`,
  ];
}

/**
 * 表格节的写法: 表头, 行数, 固定取值的列.
 *
 * @param {import("./spec.mjs").SectionSpec} section 表格节.
 * @returns {string} 一条要求.
 */
function tableSectionLine(section) {
  const table = /** @type {import("./spec.mjs").TableSpec} */ (section.table);
  const choices = Object.entries(table.choices ?? {}).map(
    ([column, values]) => `, "${column}" 只能填 ${values.join(", ")} 之一`,
  );
  return `- "${section.title}" 只放一个表格, 表头依次为 ${table.columns.map((column) => `"${column}"`).join(", ")}, 至少一行, 每格都填写${choices.join("")}.`;
}

/**
 * 只追加的条目的写法; 骨架中没有条目.
 *
 * @param {import("./file-checks.mjs").FileSpec} fileSpec 文件规格.
 * @returns {string[]} 各条要求; 没有条目时为空.
 */
function entryLines(fileSpec) {
  if (fileSpec.entryPattern === undefined) {
    return [];
  }
  const keys =
    fileSpec.entryKeys === undefined
      ? ""
      : `, 依次写 ${fileSpec.entryKeys.map((key) => `"- ${key}: 值"`).join(", ")}, 每个键只占一行`;
  const block =
    fileSpec.entryBlock === undefined
      ? ""
      : `, 最后恰好一个语言标记为 ${fileSpec.entryBlock} 的代码块, 原样放输出`;
  return [
    `- 条目在固定节之后逐条追加, 标题匹配 \`${fileSpec.entryPattern}\`${keys}${block}.`,
    ...(fileSpec.closingSections ?? []).map(closingSectionLine),
  ];
}

/**
 * 收尾节的写法: 放在全部条目之后, 带键名时每个键只占一行.
 *
 * @param {import("./spec.mjs").SectionSpec} section 收尾节.
 * @returns {string} 一条要求.
 */
function closingSectionLine(section) {
  const keys =
    section.keys === undefined
      ? ""
      : `, 依次写 ${section.keys.map((key) => `"- ${key}: 值"`).join(", ")}, 每个键只占一行`;
  return `- 收尾节 "## ${section.title}" 放在全部条目之后${keys}.`;
}
