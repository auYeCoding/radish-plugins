/**
 * @file 提交步骤的结算: 提交完成后不改写已入库的状态文件, 完成情况记在运行期登记中.
 *
 * 提交步骤开始时写下的状态文件随提交入库, 而完成提交步骤要写的内容 (最近提交,
 * 工单转为已提交, 清除阶段提交) 只有提交之后才知道. 以前提交完成的命令把它们写回
 * 状态文件, 每次提交后工作区都留着一处未入库的改动, 项目收尾之后再没有提交能带走它.
 *
 * 现在提交完成的命令只在运行期登记中记下: 内容为某个摘要的状态文件, 其提交步骤由
 * 某个提交完成. 读取状态时, 状态文件与记录的摘要一致就按记录结算; 下一次写入状态时,
 * 结算后的内容随之写入, 在下一次提交时入库. 状态文件一经改写, 摘要不同, 记录随之失效.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { finishStageCommit, isStageCommitting } from "./commit-step.mjs";
import { COMMIT_STEP_STATUSES } from "./guard.mjs";
import { navigatorPath } from "./paths.mjs";
import { readCommitSettlement, writeCommitSettlement } from "./registry.mjs";
import { readState } from "./state.mjs";
import { setOrderStatus } from "./workflow-orders.mjs";

/**
 * 提交步骤的种类: 工单提交, 阶段提交.
 * @type {Readonly<{order: "order", stage: "stage"}>}
 */
export const COMMIT_STEP_KINDS = Object.freeze({
  order: "order",
  stage: "stage",
});

/**
 * 工单提交完成后的工单状态.
 * @type {string}
 */
const COMMITTED_ORDER_STATUS = "committed";

/**
 * 读取状态文件并按提交结算记录结算. 文件不存在时返回 undefined.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {import("./state.mjs").NavigatorState | undefined} 结算后的状态.
 * @throws {SyntaxError} 状态文件不是合法 JSON 时.
 */
export function readSettledState(projectRoot) {
  const state = readState(projectRoot);
  if (state === undefined || !isSettleable(state)) {
    return state;
  }
  const record = readCommitSettlement(projectRoot);
  return record !== undefined &&
    record.stateDigest === digestStateFile(projectRoot)
    ? completeCommitStep(state, record.kind, record.commit)
    : state;
}

/**
 * 结算提交步骤: 在运行期登记中记下当前状态文件的提交步骤由哪个提交完成,
 * 返回结算后的状态, 不改写状态文件. 调用方要保证传入的状态就是状态文件的当前内容.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("./state.mjs").NavigatorState} options.state 状态文件的当前内容.
 * @param {"order" | "stage"} options.kind 提交步骤的种类, 取值见 COMMIT_STEP_KINDS.
 * @param {string} options.commit 完成提交步骤的提交.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {import("./state.mjs").NavigatorState} 结算后的状态.
 * @throws {import("./workflow-error.mjs").WorkflowError} 状态不在对应的提交步骤中时.
 */
export function settleCommitStep({ projectRoot, state, kind, commit, now }) {
  const settled = completeCommitStep(state, kind, commit);
  writeCommitSettlement(projectRoot, {
    stateDigest: digestStateFile(projectRoot),
    kind,
    commit,
    settledAt: now,
  });
  return settled;
}

/**
 * 按提交步骤的种类得到提交完成后的状态: 工单转为已提交, 或清除阶段提交;
 * 两者都把最近提交设为完成提交步骤的提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 提交步骤中的状态.
 * @param {"order" | "stage"} kind 提交步骤的种类.
 * @param {string} commit 完成提交步骤的提交.
 * @returns {import("./state.mjs").NavigatorState} 提交完成后的状态.
 * @throws {import("./workflow-error.mjs").WorkflowError} 状态不在对应的提交步骤中时.
 */
export function completeCommitStep(state, kind, commit) {
  return kind === COMMIT_STEP_KINDS.order
    ? setOrderStatus(state, COMMITTED_ORDER_STATUS, commit)
    : finishStageCommit(state, commit);
}

/**
 * 判断状态是否处于可以结算的提交步骤: 工单在提交步骤中, 或阶段提交正在提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {boolean} 可以结算时返回 true.
 */
function isSettleable(state) {
  return (
    COMMIT_STEP_STATUSES.includes(state.order?.status ?? "") ||
    isStageCommitting(state)
  );
}

/**
 * 计算状态文件当前内容的摘要.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {string} 十六进制的 SHA-256 摘要.
 */
function digestStateFile(projectRoot) {
  return createHash("sha256")
    .update(readFileSync(navigatorPath(projectRoot, "state")))
    .digest("hex");
}
