/**
 * @file 提交步骤的判断: 编排会话正在经 commit-message 提交记录的时刻.
 *
 * 提交步骤中 HEAD 会前进, 而 lastCommit 要等提交完成的命令才更新; 这期间提交
 * 历史与记录不一致是预期的, 改变状态的命令不把它当成对账异常.
 */

/**
 * 工单处于提交中的状态.
 * @type {string}
 */
export const COMMITTING_ORDER_STATUS = "committing";

/**
 * 判断当前是否处于提交步骤.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {boolean} 正在提交时返回 true.
 */
export function isCommitInProgress(state) {
  return state.order?.status === COMMITTING_ORDER_STATUS;
}
