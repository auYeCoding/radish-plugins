/**
 * @file 根据状态给出编排会话的下一动作. 纯函数, 由 enter 与 status 使用.
 *
 * 下一动作写成编排会话可以照做的一句话: 回复哪种类型, 使用第几组选项,
 * 运行哪条命令. "运行 X" 指运行插件命令 `project-navigator X`.
 */

import { COMMIT_SKILL, SUBAGENT_TYPES } from "./guard.mjs";
import { APPROVAL_REPLY_TYPE, APPROVAL_STATUSES } from "./order-approval.mjs";
import { lastStageNumber } from "./spec.mjs";
import { SELECTION_ORDER_KIND } from "./workflow-orders.mjs";
import { isProjectFinished } from "./workflow-plan.mjs";

/**
 * "验收报告" 的选项组: 判据全部通过, 有判据不通过, 只有未验证的判据, 选型工单.
 * @type {Readonly<{passed: number, fix: number, unverified: number, selection: number}>}
 */
export const REVIEW_OPTIONS = Object.freeze({
  passed: 1,
  fix: 2,
  unverified: 3,
  selection: 4,
});

/**
 * 上报技能自身问题的回复类型.
 * @type {string}
 */
export const REPORT_REPLY_TYPE = "问题报告";

/**
 * "问题报告" 的选项组: 还能继续推进, 无法继续.
 * @type {Readonly<{continuable: number, blocking: number}>}
 */
export const REPORT_OPTIONS = Object.freeze({ continuable: 1, blocking: 2 });

/**
 * 请用户决定验收结果的回复类型.
 * @type {string}
 */
export const REVIEW_REPLY_TYPE = "验收报告";

/**
 * 执行子代理工作期间的回复类型.
 * @type {string}
 */
export const RUNNING_REPLY_TYPE = "工单执行";

/**
 * 验收子代理工作期间的回复类型.
 * @type {string}
 */
export const REVIEWING_REPLY_TYPE = "工单验收";

/**
 * 处理受阻工单的回复类型.
 * @type {string}
 */
const BLOCKED_REPLY_TYPE = "受阻处理";

/**
 * 项目已确认收尾, 记录都已入库之后的回复类型.
 * @type {string}
 */
export const COMPLETE_REPLY_TYPE = "项目完成";

/**
 * 回执中表示执行受阻的执行状态关键字.
 * @type {string}
 */
export const BLOCKED_RECEIPT_KEYWORD = "受阻";

/**
 * 发布并派出执行子代理的一串动作.
 * @type {string}
 */
const DISPATCH_STEP = `运行 order set issued, 再运行 exec-brief, 把输出原样作为提示词, 用 Agent 工具在后台 (run_in_background) 派 ${SUBAGENT_TYPES.executor}, 然后`;

/**
 * 派出验收子代理的一串动作; 子代理在后台运行, 本轮要先结束时回复 "工单验收".
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 动作.
 */
function reviewDispatchStep(spec) {
  return `运行 review-brief, 把输出原样作为提示词派 ${SUBAGENT_TYPES.reviewer}; 子代理在后台运行, 本轮要先结束时${replyStep(spec, REVIEWING_REPLY_TYPE)}, 不写其它说明`;
}

/**
 * @typedef {object} GuidanceInput 判断下一动作需要的信息.
 * @property {import("./state.mjs").NavigatorState} state 当前状态.
 * @property {string | undefined} receiptStatus 当前工单回执中的执行状态; 回执不存在时为 undefined.
 * @property {string} [orderApproval] 当前工单的审阅状态, 取值见 order-approval.mjs 的 APPROVAL_STATUSES; 没有工单时省略.
 * @property {boolean} [isOrderUnchanged] 受阻工单的内容与最近一次发布时是否相同.
 * @property {boolean} [hasUncommittedRecords] 技能产物 (含状态文件) 是否有未入库的改动; 只在项目已确认收尾时需要.
 * @property {boolean} isEntry 是否是调用技能时的进入 (不是会话中途的查询).
 * @property {import("./spec.mjs").TemplateSpec} spec 模板规格, 用于写出回复类型的编号.
 */

/**
 * 写出 "回复某种类型" 这一步, 附上取骨架的命令, 编排会话不用再查编号.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {string} type 回复类型.
 * @param {number} [optionSet] 使用第几组选项; 省略时不写.
 * @returns {string} 例如 `回复 "验收报告", 使用第 2 组选项 (reply review --option 2)`.
 */
export function replyStep(spec, type, optionSet) {
  const id = spec.replies[type].id;
  return optionSet === undefined
    ? `回复 "${type}" (reply ${id})`
    : `回复 "${type}", 使用第 ${optionSet} 组选项 (reply ${id} --option ${optionSet})`;
}

/**
 * 给出下一动作.
 *
 * @param {GuidanceInput} input 判断信息.
 * @returns {string} 下一动作.
 */
export function nextAction(input) {
  const { state, spec } = input;
  if (state.stage === null) {
    return replyStep(spec, "首次接入");
  }
  if (isProjectFinished(state, lastStageNumber(spec))) {
    return finishedAction(spec, input.hasUncommittedRecords === true);
  }
  if (input.isEntry) {
    return `${replyStep(spec, "恢复进度")}; 用户选 A 后运行 status, 按其中的下一动作继续`;
  }
  return state.order === null
    ? `继续阶段 ${state.stage} 的步骤 ${state.step}`
    : orderAction(spec, state.order, input);
}

/**
 * 项目已确认收尾之后的下一动作: 记录有未入库的改动时先提交, 否则回复项目完成.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {boolean} hasUncommittedRecords 技能产物是否有未入库的改动.
 * @returns {string} 下一动作.
 */
function finishedAction(spec, hasUncommittedRecords) {
  return hasUncommittedRecords
    ? `项目已确认收尾, 但记录还有未入库的改动: 调用 ${COMMIT_SKILL}, 参数写 "提交, 纳入范围: .navigator/ 下的改动; 纳入范围之外的改动用文字列出并询问", 再${replyStep(spec, COMPLETE_REPLY_TYPE)}`
    : `项目已完成, 没有待办: ${replyStep(spec, COMPLETE_REPLY_TYPE)}; 用户选 A 或提出新需求时, 按需求变更流程新开里程, 更新推进路线后运行 stage 5; 选 B 时运行 git push (不带强制参数), 再回复 "${COMPLETE_REPLY_TYPE}"; 选 C 时不做任何操作`;
}

/**
 * 当前有工单时, 按工单状态给出下一动作.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {import("./state.mjs").OrderState} order 当前工单.
 * @param {GuidanceInput} input 判断信息.
 * @returns {string} 下一动作.
 */
function orderAction(spec, order, input) {
  switch (order.status) {
    case "drafting":
      return draftingAction(spec, order, input.orderApproval);
    case "issued":
      return issuedAction(spec, order, input.receiptStatus);
    case "blocked":
      return blockedAction(spec, order, input);
    case "reviewing":
      return reviewingAction(spec, order);
    default:
      return `工单 ${order.id} 处于未知状态 ${order.status}`;
  }
}

/**
 * 起草中的工单的下一动作: 先请用户审阅, 用户认可当前内容后发布并派出执行子代理.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {{id: string}} order 当前工单.
 * @param {string | undefined} orderApproval 工单的审阅状态.
 * @returns {string} 下一动作.
 */
function draftingAction(spec, order, orderApproval) {
  const dispatch = `${DISPATCH_STEP}${replyStep(spec, RUNNING_REPLY_TYPE)}`;
  switch (orderApproval) {
    case APPROVAL_STATUSES.approved:
      return `工单 ${order.id} 已经用户审阅: ${dispatch}`;
    case APPROVAL_STATUSES.awaiting:
      return `等用户在 "${APPROVAL_REPLY_TYPE}" 中选择: 选 A 后${dispatch}; 用户要修改时, 改好工单文件后再${replyStep(spec, APPROVAL_REPLY_TYPE)}`;
    default:
      return `写完工单 ${order.id} 的 order.md, ${replyStep(spec, APPROVAL_REPLY_TYPE)}; 用户选 A 后${dispatch}`;
  }
}

/**
 * 已发布工单的下一动作: 回执写入前等执行子代理, 写入后按执行状态处理.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {{id: string}} order 当前工单.
 * @param {string | undefined} receiptStatus 回执中的执行状态.
 * @returns {string} 下一动作.
 */
function issuedAction(spec, order, receiptStatus) {
  if (receiptStatus === undefined) {
    return `工单 ${order.id} 由执行子代理处理中: ${replyStep(spec, RUNNING_REPLY_TYPE)}; 子代理结束后会自动通知, 届时运行 status. 子代理已结束但回执没有写入时, 用 SendMessage 请它按回执骨架补写`;
  }
  return receiptStatus.includes(BLOCKED_RECEIPT_KEYWORD)
    ? `工单 ${order.id} 执行受阻: 读回执, 运行 order set blocked, 再${replyStep(spec, BLOCKED_REPLY_TYPE)}, 按受阻类型选择选项组`
    : `工单 ${order.id} 执行完成: 运行 order set reviewing, 再${reviewDispatchStep(spec)}`;
}

/**
 * 受阻工单的下一动作: 内容没有改动时直接继续, 改动后要重新审阅.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {{id: string}} order 当前工单.
 * @param {GuidanceInput} input 判断信息.
 * @returns {string} 下一动作.
 */
function blockedAction(spec, order, input) {
  if (input.orderApproval === APPROVAL_STATUSES.approved) {
    return `工单 ${order.id} 的修改已经用户审阅: ${DISPATCH_STEP}${replyStep(spec, RUNNING_REPLY_TYPE)}`;
  }
  return `工单 ${order.id} 受阻: ${replyStep(spec, BLOCKED_REPLY_TYPE)}; 用户完成所需操作而工单没有改动时, 运行 order set issued, 用 SendMessage 让原执行子代理继续 (找不到它时运行 exec-brief 重新派出), 再${replyStep(spec, RUNNING_REPLY_TYPE)}; 要修改工单时, 改好后${replyStep(spec, APPROVAL_REPLY_TYPE)}${input.isOrderUnchanged === false ? ". 工单文件已在发布后改动, 必须重新审阅" : ""}`;
}

/**
 * 验收中的工单的下一动作: 派验收子代理, 写验收记录, 按判据结论选择选项组.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {{id: string, kind: string}} order 当前工单.
 * @returns {string} 下一动作.
 */
function reviewingAction(spec, order) {
  const brief = `${reviewDispatchStep(spec)}; 结果回来后把结论写入 review.md, 再`;
  return order.kind === SELECTION_ORDER_KIND
    ? `选型工单 ${order.id} 验收中: ${brief}${replyStep(spec, REVIEW_REPLY_TYPE, REVIEW_OPTIONS.selection)}, 由用户决定是否采用`
    : `工单 ${order.id} 验收中: ${brief}${replyStep(spec, REVIEW_REPLY_TYPE)}: 判据全部通过用第 ${REVIEW_OPTIONS.passed} 组, 有不通过用第 ${REVIEW_OPTIONS.fix} 组, 只有未验证用第 ${REVIEW_OPTIONS.unverified} 组`;
}
