/**
 * @file 根据状态与模板规格生成 "当前进展" 各行与回复骨架.
 *
 * 编排者先取得骨架再填写内容, 进展行由脚本计算, 避免模型自己数 "2/5" 出错.
 */

import { findReply, lastStageNumber } from "./spec.mjs";
import { renderTable } from "./table.mjs";

/**
 * 骨架中待编排者填写的位置标记; 校验时发现它残留即判为未完成.
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
 * 计算 "当前进展" 四个键的值.
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
    state.order?.id ?? empty,
  ];
}

/**
 * 生成 "当前进展" 一节, 含二级标题.
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
 * 启动提示词之前的固定说明.
 * @type {string}
 */
const LAUNCH_PROMPT_INTRO =
  "在仓库根目录新开一个 Claude Code 会话, 粘贴下面的启动提示词.";

/**
 * 生成某种回复的骨架文本.
 *
 * @param {object} options 生成参数.
 * @param {string} options.type 回复类型.
 * @param {number} [options.optionSetIndex] 使用第几组选项, 从 0 开始.
 * @param {import("./state.mjs").NavigatorState | undefined} options.state 状态.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {string} [options.launchPrompt] 启动提示词; 提供时填入允许放启动提示词的节.
 * @returns {string} 骨架文本, 以换行结尾.
 * @throws {Error} 回复类型或选项组不存在时.
 */
export function renderReplySkeleton({
  type,
  optionSetIndex = 0,
  state,
  spec,
  launchPrompt,
}) {
  const reply = findReply(spec, type);
  if (reply === undefined) {
    throw new Error(`render: 未知的回复类型 "${type}"`);
  }
  const optionSet = reply.optionSets[optionSetIndex];
  if (optionSet === undefined) {
    throw new Error(`render: "${type}" 没有第 ${optionSetIndex + 1} 组选项`);
  }
  const lines = [
    `# ${type}`,
    "",
    ...renderProgressSection(state, spec),
    ...reply.sections.flatMap((section) => [
      "",
      ...renderSection(section, spec, launchPrompt),
    ]),
    "",
    ...renderOptionBlock(optionSet),
    "",
    `${CODE_FENCE}${spec.format.summaryLanguage}`,
    spec.format.summarySeparator,
    PLACEHOLDER,
    CODE_FENCE,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * 生成某种记录文件的骨架: 一级标题, 当前进展 (如有), 固定节与人类总结.
 * 只追加的条目由编排会话在文件创建后逐条添加, 不在骨架中.
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
  const sections = (fileSpec.variants ?? [fileSpec.sections ?? []])[
    variantIndex
  ];
  if (sections === undefined) {
    throw new Error(
      `render: "${fileSpec.title}" 没有第 ${variantIndex + 1} 种结构`,
    );
  }
  const lines = [
    `# ${fileSpec.title}`,
    ...(fileSpec.hasProgress === true
      ? ["", ...renderProgressSection(state, spec)]
      : []),
    ...sections.flatMap((section) => [
      "",
      ...renderSection(section, spec, undefined, prefills[section.title]),
    ]),
    "",
    `${CODE_FENCE}${spec.format.summaryLanguage}`,
    spec.format.summarySeparator,
    PLACEHOLDER,
    CODE_FENCE,
  ];
  return `${lines.join("\n")}\n`;
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
 * 生成一个节的骨架; 允许放启动提示词的节在提供了提示词时直接填好;
 * 表格节给出表头与一行占位; 没有键名的节可以在占位标记之前预填若干行.
 *
 * @param {import("./spec.mjs").SectionSpec} section 节规格.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {string | undefined} launchPrompt 启动提示词.
 * @param {readonly string[]} [prefill] 预填行.
 * @returns {string[]} 各行文本, 含二级标题.
 */
function renderSection(section, spec, launchPrompt, prefill = []) {
  if (section.table !== undefined) {
    return [
      `## ${section.title}`,
      "",
      ...renderTable(section.table.columns, [
        section.table.columns.map(() => PLACEHOLDER),
      ]),
    ];
  }
  if (section.allowLaunchPrompt === true && launchPrompt !== undefined) {
    return [
      `## ${section.title}`,
      "",
      LAUNCH_PROMPT_INTRO,
      "",
      `${CODE_FENCE}${spec.format.launchPromptLanguage}`,
      launchPrompt,
      CODE_FENCE,
    ];
  }
  const body =
    section.keys === undefined
      ? [...prefill, PLACEHOLDER]
      : section.keys.map((key) => `- ${key}: ${PLACEHOLDER}`);
  return [`## ${section.title}`, "", ...body];
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
