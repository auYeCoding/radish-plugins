/**
 * @file 执行会话的登记与对齐: 从启动提示词或读取工单文件识别执行会话,
 * 从用户对 "开工对齐" 的选择识别对齐完成.
 *
 * 当前或曾经的编排会话一律不登记为执行会话; 只有状态为已发布的当前工单可以被执行.
 */

import { LAUNCH_PROMPT_PATTERN } from "./briefs.mjs";
import { isChoiceSelected } from "./option-answer.mjs";
import {
  orderFilePath,
  projectRelativePath,
  relativePathsEqual,
} from "./paths.mjs";
import { writeExecutorRecord } from "./registry.mjs";
import { isOrchestratorSession, readOrchestrators } from "./sessions.mjs";

/**
 * 执行会话请求用户确认计划时使用的回复类型.
 * @type {string}
 */
export const ALIGNMENT_REPLY_TYPE = "开工对齐";

/**
 * 可以被执行的工单状态.
 * @type {string}
 */
const EXECUTABLE_STATUS = "issued";

/**
 * 开工对齐中表示 "继续执行" 的选项位置: 第 1 组第 1 项.
 * @type {Readonly<{optionSet: number, choice: number}>}
 */
const ALIGNMENT_CONFIRM_CHOICE = Object.freeze({ optionSet: 0, choice: 0 });

/**
 * 从用户消息中找出要执行的工单.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} prompt 用户消息.
 * @returns {{order?: {id: string, folder: string}, problem?: string}} 可以执行的工单, 或不能执行的原因; 消息不是启动提示词时两者都没有.
 */
export function findLaunchedOrder(state, prompt) {
  const match = LAUNCH_PROMPT_PATTERN.exec(prompt);
  if (match === null) {
    return {};
  }
  const order = state.order;
  if (order === null || order.id !== match[1]) {
    return {
      problem: `工单 ${match[1]} 不是当前工单, 本会话没有登记为执行会话. 请到编排会话确认当前工单.`,
    };
  }
  if (order.status !== EXECUTABLE_STATUS) {
    return {
      problem: `工单 ${order.id} 的状态是 ${order.status}, 还不能执行. 请到编排会话确认工单已发布.`,
    };
  }
  return { order };
}

/**
 * 判断读取的文件是否为当前可执行工单的工单文件.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} projectRoot 项目根目录.
 * @param {string} filePath 读取的文件路径.
 * @returns {{id: string, folder: string} | undefined} 对应的工单; 不是时为 undefined.
 */
export function orderReadBy(state, projectRoot, filePath) {
  const order = state.order;
  const relative = projectRelativePath(projectRoot, filePath);
  if (
    order === null ||
    order.status !== EXECUTABLE_STATUS ||
    relative === undefined ||
    !relativePathsEqual(relative, orderFilePath(order.folder, "order"))
  ) {
    return undefined;
  }
  return order;
}

/**
 * 把会话登记为某张工单的执行会话; 当前或曾经的编排会话不登记.
 *
 * @param {object} options 登记参数.
 * @param {string} options.worktreeRoot 工作区根目录.
 * @param {string} options.sessionId 会话编号.
 * @param {{id: string, folder: string}} options.order 工单.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {boolean} 完成登记时返回 true.
 */
export function registerExecutor({ worktreeRoot, sessionId, order, now }) {
  if (isOrchestratorSession(readOrchestrators(worktreeRoot), sessionId)) {
    return false;
  }
  writeExecutorRecord(worktreeRoot, {
    sessionId,
    order: order.id,
    folder: order.folder,
    registeredAt: now,
    isAligned: false,
    isAwaitingAlignment: false,
  });
  return true;
}

/**
 * 计算执行会话在守卫中的状态: 绑定的工单是否仍在执行中, 是否已就本轮发布完成对齐.
 *
 * @param {import("./registry.mjs").ExecutorRecord | undefined} record 执行登记.
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {{executorFolder: string | undefined, isOrderActive: boolean, isAligned: boolean}} 守卫所需的执行状态.
 */
export function executorGuardState(record, state) {
  const order = state.order;
  const isOrderActive =
    record !== undefined &&
    order !== null &&
    record.order === order.id &&
    order.status === EXECUTABLE_STATUS;
  return {
    executorFolder: record?.folder,
    isOrderActive,
    isAligned:
      isOrderActive && record.isAligned && record.alignedRound === order.round,
  };
}

/**
 * 记录用户在开工对齐中的选择: 选 A 时就本轮发布完成对齐; 否则取消等待,
 * 执行会话需要重新输出开工对齐.
 *
 * @param {import("./registry.mjs").ExecutorRecord} record 执行登记.
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} prompt 用户消息.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格, 用于识别选项.
 * @returns {import("./registry.mjs").ExecutorRecord} 新的执行登记.
 */
export function applyAlignmentAnswer(record, state, prompt, spec) {
  if (!isAlignmentConfirmed(prompt, spec) || state.order?.id !== record.order) {
    return { ...record, isAwaitingAlignment: false };
  }
  return {
    ...record,
    isAligned: true,
    alignedRound: state.order.round,
    isAwaitingAlignment: false,
  };
}

/**
 * 判断用户消息是否为开工对齐中的 "A. 继续执行.".
 *
 * @param {string} prompt 用户消息.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {boolean} 是时返回 true.
 */
export function isAlignmentConfirmed(prompt, spec) {
  return isChoiceSelected(
    prompt,
    spec.replies[ALIGNMENT_REPLY_TYPE].optionSets[
      ALIGNMENT_CONFIRM_CHOICE.optionSet
    ],
    ALIGNMENT_CONFIRM_CHOICE.choice,
  );
}
