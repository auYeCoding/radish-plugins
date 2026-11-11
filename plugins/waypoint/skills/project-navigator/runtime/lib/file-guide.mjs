/**
 * @file template 命令在骨架之前给出的填写要求: 标题与键名的保留, 键值节与表格节的
 * 写法, 代码块, 以及写完后的自查命令.
 *
 * 写入时不做结构校验; 要求在填写的时刻给出, 写完后用 check 命令自查. 内容全部
 * 由文件规格生成, 与自查使用同一份规格.
 */

import { COMMAND_NAME } from "./paths.mjs";
import { PLACEHOLDER } from "./render.mjs";
import { wrapGuide } from "./reply-guide.mjs";

/**
 * 写完记录文件后自查结构的命令前缀, 其后接文件路径.
 * @type {string}
 */
const SELF_CHECK_COMMAND = `${COMMAND_NAME} check`;

/**
 * 键值节的写法. 读取记录的脚本按键值行取值, 模型常在键下面接表格或列表;
 * 参考文档与执行手册也引用这一句.
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
 * @returns {string[]} 各行.
 */
export function renderFileGuide({ fileSpec, sections }) {
  return wrapGuide([
    `- 文件从下面的 "# ${fileSpec.title}" 写起. 只替换 "${PLACEHOLDER}", 标题与键名原样保留, 不增删二级标题.`,
    ...keySectionLines(sections),
    ...sections
      .filter((section) => section.table !== undefined)
      .map(tableSectionLine),
    ...entryLines(fileSpec),
    "- 文件中不放代码块, 不贴代码.",
    `- 写完后运行 \`${SELF_CHECK_COMMAND} <文件路径>\` 自查结构.`,
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
  const rows = table.allowEmpty === true ? "没有内容时只留表头" : "至少一行";
  return `- "${section.title}" 只放一个表格, 表头依次为 ${table.columns.map((column) => `"${column}"`).join(", ")}, ${rows}, 每格都填写${choices.join("")}.`;
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
  return [
    `- 条目在固定节之后逐条追加, 标题匹配 \`${fileSpec.entryPattern}\`${keys}.`,
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
