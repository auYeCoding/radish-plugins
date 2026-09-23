/**
 * @file 判断会话身份: 编排会话, 执行会话或其它会话.
 */

import { readExecutorRecord } from "./registry.mjs";

/**
 * 把会话登记为编排会话; 原编排会话记入曾经的编排会话, 此后不会被登记为执行会话.
 *
 * @param {import("./state.mjs").NavigatorState} state 状态.
 * @param {string} sessionId 新的编排会话.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {import("./state.mjs").NavigatorState} 新状态; 该会话已是编排会话时为原状态.
 */
export function claimSession(state, sessionId, now) {
  const previous = state.session?.id;
  if (previous === sessionId) {
    return state;
  }
  const formerSessions =
    previous === undefined || state.formerSessions.includes(previous)
      ? state.formerSessions
      : [...state.formerSessions, previous];
  return {
    ...state,
    session: { id: sessionId, claimedAt: now },
    formerSessions,
  };
}

/**
 * 判断会话当前或曾经是编排会话; 这些会话不能登记为执行会话.
 *
 * @param {import("./state.mjs").NavigatorState} state 状态.
 * @param {string} sessionId 会话编号.
 * @returns {boolean} 当前或曾经是编排会话时返回 true.
 */
export function isOrchestratorSession(state, sessionId) {
  return (
    state.session?.id === sessionId || state.formerSessions.includes(sessionId)
  );
}

/**
 * 根据状态与运行期登记判断会话身份.
 *
 * 编排会话以 `state.json` 中登记的会话编号为准, 后调用技能的会话会覆盖它;
 * 执行会话以运行期登记为准; 其余都是其它会话.
 *
 * @param {object} options 判断参数.
 * @param {import("./state.mjs").NavigatorState} options.state 当前状态.
 * @param {string} options.sessionId 会话编号.
 * @param {string} options.worktreeRoot 工作区根目录.
 * @returns {import("./guard.mjs").SessionRole} 会话身份.
 */
export function identifyRole({ state, sessionId, worktreeRoot }) {
  if (state.session?.id !== undefined && state.session.id === sessionId) {
    return "orchestrator";
  }
  if (readExecutorRecord(worktreeRoot, sessionId) !== undefined) {
    return "executor";
  }
  return "other";
}
