/**
 * @file 项目的代码检查命令: 登记, 生成工单中的固定判据, 发布前核对.
 *
 * 模块化与代码质量的机械检查交给各语言成熟的检查工具 (例如函数长度与复杂度规则),
 * 插件不自己解析代码. 选型阶段确定检查命令并登记后, 每张会改动代码的工单都带一条
 * 固定判据 "代码检查通过", 检查命令自动算作已授权测试, 验收子代理运行它.
 */

import { splitSections } from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 需要代码检查判据的工单类型: 会改动代码的工单.
 * @type {readonly string[]}
 */
export const CODE_CHECKED_ORDER_KINDS = Object.freeze([
  "implementation",
  "fix",
]);

/**
 * 工单中放判据的节, 与规格 files.order 中的节标题一致.
 * @type {string}
 */
export const CRITERIA_SECTION = "验收判据";

/**
 * @typedef {object} CodeChecks 项目登记的代码检查.
 * @property {string[]} commands 检查命令, 每条都要能在仓库根目录直接运行.
 * @property {string | null} reason 没有检查命令时的原因; 有命令时为 null.
 */

/**
 * 判断某种工单是否需要代码检查判据.
 *
 * @param {string} kind 工单类型.
 * @returns {boolean} 需要时返回 true.
 */
export function requiresCodeCheck(kind) {
  return CODE_CHECKED_ORDER_KINDS.includes(kind);
}

/**
 * 生成代码检查判据的原文. 工单骨架预填这一条, 发布时按原文核对.
 *
 * @param {readonly string[]} commands 检查命令.
 * @returns {string} 判据原文.
 */
export function codeCheckCriterion(commands) {
  return `代码检查通过: 运行 ${commands.map((command) => `\`${command}\``).join(", ")}, 没有报错.`;
}

/**
 * 登记代码检查命令, 覆盖此前的登记. 没有命令时必须写明原因.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {{commands: string[], reason: string}} draft 草稿: 检查命令与原因.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有命令也没有原因时.
 */
export function registerCodeChecks(state, { commands, reason }) {
  const cleaned = [
    ...new Set(commands.map((command) => command.trim()).filter(Boolean)),
  ];
  const trimmedReason = reason.trim();
  if (cleaned.length === 0 && trimmedReason === "") {
    throw new WorkflowError(
      '没有代码检查命令时, 草稿中必须用 "reason" 写明原因, 并经用户同意.',
    );
  }
  return {
    ...state,
    codeChecks: {
      commands: cleaned,
      reason: cleaned.length === 0 ? trimmedReason : null,
    },
    lastAction: `登记代码检查命令 ${cleaned.length} 条`,
  };
}

/**
 * 描述已登记的代码检查, 用于命令输出.
 *
 * @param {CodeChecks | null} codeChecks 已登记的代码检查.
 * @returns {string} 描述.
 */
export function describeCodeChecks(codeChecks) {
  if (codeChecks === null) {
    return "未登记";
  }
  return codeChecks.commands.length === 0
    ? `无, 原因: ${codeChecks.reason}`
    : codeChecks.commands.join("; ");
}

/**
 * 当前工单的全部可运行测试: 需要代码检查的工单先放检查命令, 再放用户授权的测试.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {string[]} 去重后的命令.
 */
export function orderTestCommands(state) {
  const order = state.order;
  if (order === null) {
    return [];
  }
  const checks = requiresCodeCheck(order.kind)
    ? (state.codeChecks?.commands ?? [])
    : [];
  return [...new Set([...checks, ...(order.authorizedTests ?? [])])];
}

/**
 * 工单骨架中预填的内容: 需要代码检查且已登记命令时, 验收判据第一条是检查判据.
 *
 * @param {import("./state.mjs").NavigatorState | undefined} state 当前状态.
 * @returns {Readonly<Record<string, string[]>>} 节标题到预填行的映射.
 */
export function orderSkeletonPrefills(state) {
  const order = state?.order ?? null;
  const commands = state?.codeChecks?.commands ?? [];
  if (
    order === null ||
    !requiresCodeCheck(order.kind) ||
    commands.length === 0
  ) {
    return {};
  }
  return { [CRITERIA_SECTION]: [`1. ${codeCheckCriterion(commands)}`] };
}

/**
 * 找出工单不能发布的原因: 需要代码检查的工单, 项目必须已登记检查命令,
 * 且验收判据中含有检查判据的原文.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string | undefined} orderText 工单文件内容; 文件不存在时为 undefined.
 * @returns {string | undefined} 不能发布的原因; 可以发布时为 undefined.
 */
export function issueBlocker(state, orderText) {
  const order = state.order;
  if (order === null || !requiresCodeCheck(order.kind)) {
    return undefined;
  }
  const codeChecks = state.codeChecks ?? null;
  if (codeChecks === null) {
    return `工单 ${order.id} 会改动代码, 但项目还没有登记代码检查命令. 先确定检查命令 (选型阶段由执行会话选定并配置, 含函数长度与复杂度规则), 写草稿 {"commands": ["命令"]} 后运行 codecheck set --from <草稿>; 确实没有合适的工具时, 经用户同意写 {"commands": [], "reason": "原因"} 登记.`;
  }
  if (codeChecks.commands.length === 0) {
    return undefined;
  }
  const criterion = codeCheckCriterion(codeChecks.commands);
  return criteriaText(orderText ?? "").includes(criterion)
    ? undefined
    : `工单 ${order.id} 的 "${CRITERIA_SECTION}" 缺少代码检查判据, 请原样加入: ${criterion}`;
}

/**
 * 取出工单文件中验收判据一节的全部文字.
 *
 * @param {string} orderText 工单文件内容.
 * @returns {string} 该节文字; 没有该节时为空字符串.
 */
function criteriaText(orderText) {
  const section = splitSections(parseMarkdown(orderText)).sections.find(
    (entry) => entry.title === CRITERIA_SECTION,
  );
  return (section?.items ?? [])
    .map((item) => (item.kind === "text" ? item.text : ""))
    .join("\n");
}
