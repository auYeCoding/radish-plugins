/**
 * @file 提交步骤: 工单验收后的提交, 以及初始化与阶段完成后的阶段提交.
 *
 * 提交步骤中 HEAD 会前进, 而 lastCommit 要等提交完成的命令结算后才更新; 这期间
 * 提交历史与记录不一致是预期的, 改变状态的命令不把它当成对账异常. 结算不改写
 * 状态文件, 见 commit-settlement.mjs.
 *
 * 阶段提交的流转: 初始化自检通过, 或推进阶段时有尚未入库的技能产物, 登记为
 * awaiting (等用户在 "阶段提交" 中选择); 用户选择提交后转为 committing, 经
 * commit-message 提交, 完成后结算: 清除登记并把 lastCommit 设为 HEAD; 用户选择
 * 暂不提交时直接清除登记.
 */

import { WorkflowError } from "./workflow-error.mjs";

/**
 * 工单处于提交中的状态.
 * @type {string}
 */
export const COMMITTING_ORDER_STATUS = "committing";

/**
 * 阶段提交的状态: 等用户选择, 正在提交.
 * @type {Readonly<{awaiting: string, committing: string}>}
 */
export const STAGE_COMMIT_STATUSES = Object.freeze({
  awaiting: "awaiting",
  committing: "committing",
});

/**
 * 阶段提交的回复类型.
 * @type {string}
 */
export const STAGE_COMMIT_REPLY_TYPE = "阶段提交";

/**
 * @typedef {object} StageCommit 待处理的阶段提交.
 * @property {string} label 提交的是哪一段成果, 例如 "初始化" 或 "阶段 1 (立项) 完成".
 * @property {string} status 状态, 取值见 STAGE_COMMIT_STATUSES.
 */

/**
 * 判断当前是否处于提交步骤: 工单正在提交, 或阶段提交正在提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {boolean} 正在提交时返回 true.
 */
export function isCommitInProgress(state) {
  return (
    state.order?.status === COMMITTING_ORDER_STATUS || isStageCommitting(state)
  );
}

/**
 * 判断阶段提交是否正在提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {boolean} 正在提交时返回 true.
 */
export function isStageCommitting(state) {
  return state.stageCommit?.status === STAGE_COMMIT_STATUSES.committing;
}

/**
 * 登记一次待处理的阶段提交, 等用户在 "阶段提交" 中选择.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} label 提交的是哪一段成果.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 */
export function requestStageCommit(state, label) {
  return {
    ...state,
    stageCommit: { label, status: STAGE_COMMIT_STATUSES.awaiting },
  };
}

/**
 * 用户选择提交后, 阶段提交转为正在提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有等用户选择的阶段提交时.
 */
export function startStageCommit(state) {
  const pending = requireStageCommit(state, STAGE_COMMIT_STATUSES.awaiting);
  return {
    ...state,
    stageCommit: { ...pending, status: STAGE_COMMIT_STATUSES.committing },
    lastAction: `开始阶段提交: ${pending.label}`,
  };
}

/**
 * 提交完成后的状态: 清除阶段提交, 把 lastCommit 设为完成提交的 HEAD.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} head 提交后的 HEAD.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 阶段提交不在提交中时.
 */
export function finishStageCommit(state, head) {
  const pending = requireStageCommit(state, STAGE_COMMIT_STATUSES.committing);
  return {
    ...state,
    stageCommit: null,
    lastCommit: head,
    lastAction: `阶段提交完成: ${pending.label}`,
  };
}

/**
 * 用户选择暂不提交: 清除阶段提交, 记录保持未入库.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有等用户选择的阶段提交时.
 */
export function skipStageCommit(state) {
  const pending = requireStageCommit(state, STAGE_COMMIT_STATUSES.awaiting);
  return {
    ...state,
    stageCommit: null,
    lastAction: `暂不提交: ${pending.label}`,
  };
}

/**
 * 确认没有未处理的阶段提交; 推进阶段与新建工单之前调用, 避免多个阶段的成果
 * 挤在一次提交中.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} replyStep 回复 "阶段提交" 这一步的写法.
 * @returns {void}
 * @throws {WorkflowError} 有未处理的阶段提交时.
 */
export function assertNoStageCommit(state, replyStep) {
  if (state.stageCommit !== null && state.stageCommit !== undefined) {
    throw new WorkflowError(
      `阶段提交 "${state.stageCommit.label}" 尚未处理: 先${replyStep}, 按用户的选择提交或暂不提交, 再继续推进.`,
    );
  }
}

/**
 * 取出指定状态的阶段提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} status 期望的状态.
 * @returns {StageCommit} 阶段提交.
 * @throws {WorkflowError} 没有该状态的阶段提交时.
 */
function requireStageCommit(state, status) {
  const pending = state.stageCommit;
  if (pending === null || pending === undefined || pending.status !== status) {
    throw new WorkflowError(
      status === STAGE_COMMIT_STATUSES.awaiting
        ? "当前没有等用户选择的阶段提交."
        : "阶段提交还没有开始: 用户选择提交后先运行 stagecommit start.",
    );
  }
  return pending;
}
