/**
 * @file 根据状态与模板规格生成进展行, 记录文件的 "当前进展" 一节, 以及回复与
 * 记录文件的骨架.
 *
 * 编排会话先取得骨架再填写内容, 进展由脚本计算, 避免模型自己数 "2/5" 出错.
 */

import { findReply, lastStageNumber } from "./spec.mjs";
import { renderTable } from "./table.mjs";

/**
 * 骨架中待填写的位置标记; 校验时发现它残留即判为未完成.
 * @type {string}
 */
export const PLACEHOLDER = "<待填写>";

/**
 * 围栏代码块使用的三个反引号.
 * @type {string}
 */
const CODE_FENCE = "```";

/**
 * 选项的字母前缀, 按顺序使用.
 * @type {string}
 */
export const OPTION_LETTERS = "ABCDEFGH";

/**
 * 计算进展四项的值: 阶段, 里程, 切片, 工单.
 *
 * @param {import("./state.mjs").NavigatorState | undefined} state 状态; 未初始化时为 undefined.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 与 `format.progressKeys` 顺序一致的值.
 */
export function progressValues(state, spec) {
  const empty = spec.format.emptyValue;
  if (state === undefined) {
    return spec.format.progressKeys.map(() => empty);
  }
  return [
    formatStage(state.stage, spec),
    formatPosition(state.milestones, state.milestone, empty),
    formatPosition(state.slices, state.slice, empty),
    state.order?.id ?? formatNoOrder(state.orders, empty),
  ];
}

/**
 * 生成回复中的一行进展, 例如 "阶段 5/6 (切片) · 里程 3/5 (导出) · 切片 4/10 (报表) · 工单 0007".
 *
 * @param {import("./state.mjs").NavigatorState | undefined} state 状态.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 进展行.
 */
export function progressLine(state, spec) {
  const values = progressValues(state, spec);
  return spec.format.progressLabels
    .map((label, index) => `${label} ${values[index]}`)
    .join(spec.format.progressSeparator);
}

/**
 * 生成记录文件的 "当前进展" 一节, 含二级标题.
 *
 * @param {import("./state.mjs").NavigatorState | undefined} state 状态.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 各行文本.
 */
export function renderProgressSection(state, spec) {
  const values = progressValues(state, spec);
  return [
    `## ${spec.format.progressTitle}`,
    "",
    ...spec.format.progressKeys.map(
      (key, index) => `- ${key}: ${values[index]}`,
    ),
  ];
}

/**
 * 生成某种回复的骨架: 一级标题, 结论行, 进展行, 各节与选项块. 规格中没有
 * 选项组的回复不需要用户选择, 骨架不带选项块.
 *
 * @param {object} options 生成参数.
 * @param {string} options.type 回复类型.
 * @param {number} [options.optionSetIndex] 使用第几组选项, 从 0 开始.
 * @param {import("./state.mjs").NavigatorState | undefined} options.state 状态.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {Readonly<Record<string, string>>} [options.values] 键名到预填值的映射, 用于脚本已知的键值.
 * @returns {string} 骨架文本, 以换行结尾.
 * @throws {Error} 回复类型或选项组不存在时.
 */
export function renderReplySkeleton({
  type,
  optionSetIndex = 0,
  state,
  spec,
  values = {},
}) {
  const reply = findReply(spec, type);
  if (reply === undefined) {
    throw new Error(`render: 未知的回复类型 "${type}"`);
  }
  const hasOptions = reply.optionSets.length > 0;
  const optionSet = reply.optionSets[optionSetIndex];
  if (hasOptions && optionSet === undefined) {
    throw new Error(`render: "${type}" 没有第 ${optionSetIndex + 1} 组选项`);
  }
  const lines = [
    `# ${type}`,
    "",
    `${spec.format.conclusionLabel}: ${PLACEHOLDER}`,
    "",
    progressLine(state, spec),
    ...reply.sections.flatMap((section) => [
      "",
      ...renderSection(section, values),
    ]),
    ...(hasOptions ? ["", ...renderOptionBlock(optionSet)] : []),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * 生成某种记录文件的骨架: 一级标题, 当前进展 (如有) 与固定节.
 * 只追加的条目在文件创建后逐条添加, 不在骨架中.
 *
 * @param {object} options 生成参数.
 * @param {import("./file-checks.mjs").FileSpec} options.fileSpec 文件规格.
 * @param {number} [options.variantIndex] 使用第几种固定节序列, 从 0 开始.
 * @param {import("./state.mjs").NavigatorState | undefined} options.state 状态.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {Readonly<Record<string, string[]>>} [options.prefills] 节标题到预填行的映射, 预填行放在占位标记之前.
 * @returns {string} 骨架文本, 以换行结尾.
 * @throws {Error} 固定节序列不存在时.
 */
export function renderFileSkeleton({
  fileSpec,
  variantIndex = 0,
  state,
  spec,
  prefills = {},
}) {
  const sections = fileSections(fileSpec, variantIndex);
  const lines = [
    `# ${fileSpec.title}`,
    ...(fileSpec.hasProgress === true
      ? ["", ...renderProgressSection(state, spec)]
      : []),
    ...sections.flatMap((section) => [
      "",
      ...renderSection(section, {}, prefills[section.title]),
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * 取出某种记录文件的一种固定节序列.
 *
 * @param {import("./file-checks.mjs").FileSpec} fileSpec 文件规格.
 * @param {number} variantIndex 使用第几种固定节序列, 从 0 开始.
 * @returns {import("./spec.mjs").SectionSpec[]} 固定节序列.
 * @throws {Error} 固定节序列不存在时.
 */
export function fileSections(fileSpec, variantIndex) {
  const sections = (fileSpec.variants ?? [fileSpec.sections ?? []])[
    variantIndex
  ];
  if (sections === undefined) {
    throw new Error(
      `render: "${fileSpec.title}" 没有第 ${variantIndex + 1} 种结构`,
    );
  }
  return sections;
}

/**
 * 生成选项代码块.
 *
 * @param {import("./spec.mjs").OptionSetSpec} optionSet 选项组.
 * @returns {string[]} 代码块各行, 含围栏.
 */
export function renderOptionBlock(optionSet) {
  return [
    CODE_FENCE,
    `[${optionSet.title}]`,
    "",
    ...optionSet.choices.map(
      (choice, index) => `${OPTION_LETTERS[index]}. ${choice}`,
    ),
    CODE_FENCE,
  ];
}

/**
 * 生成一个节的骨架: 表格节给出表头与一行占位; 键值行依次使用调用方给的值,
 * 规格中的预填值, 其余留占位标记; 没有键名的节可以在占位标记之前预填若干行.
 *
 * @param {import("./spec.mjs").SectionSpec} section 节规格.
 * @param {Readonly<Record<string, string>>} values 键名到预填值的映射.
 * @param {readonly string[]} [prefill] 预填行.
 * @returns {string[]} 各行文本, 含二级标题.
 */
function renderSection(section, values, prefill = []) {
  if (section.table !== undefined) {
    return [
      `## ${section.title}`,
      "",
      ...renderTable(section.table.columns, [
        section.table.columns.map(() => PLACEHOLDER),
      ]),
    ];
  }
  const body =
    section.keys === undefined
      ? [...prefill, PLACEHOLDER]
      : section.keys.map(
          (key) =>
            `- ${key}: ${values[key] ?? section.presets?.[key] ?? PLACEHOLDER}`,
        );
  return [`## ${section.title}`, "", ...body];
}

/**
 * 没有当前工单时的写法: 有已结束的工单时附上最近一张的编号与结束状态, 例如
 * 验收不通过之后的验收报告仍能看出说的是哪张工单.
 *
 * @param {readonly {id: string, status: string}[] | undefined} orders 已结束的工单摘要.
 * @param {string} empty 字段不适用时写的值.
 * @returns {string} 当前工单一项的值.
 */
function formatNoOrder(orders, empty) {
  const last = orders?.at(-1);
  return last === undefined
    ? empty
    : `${empty} (上一张 ${last.id} 已结束, ${last.status})`;
}

/**
 * 格式化阶段, 例如 "5/6 (切片)".
 *
 * @param {number | null} stage 阶段编号.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 显示值.
 */
function formatStage(stage, spec) {
  if (stage === null) {
    return spec.format.emptyValue;
  }
  return `${stage}/${lastStageNumber(spec)} (${spec.stages[stage]})`;
}

/**
 * 格式化里程或切片的位置, 例如 "2/5 (导出报表)".
 *
 * @param {{id: string, name: string}[]} entries 全部条目, 按顺序.
 * @param {string | null} currentId 当前条目编号.
 * @param {string} empty 不适用时的值.
 * @returns {string} 显示值.
 */
function formatPosition(entries, currentId, empty) {
  const index = entries.findIndex((entry) => entry.id === currentId);
  if (currentId === null || index < 0) {
    return empty;
  }
  return `${index + 1}/${entries.length} (${entries[index].name})`;
}
