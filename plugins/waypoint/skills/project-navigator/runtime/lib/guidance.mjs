/**
 * @file 根据状态与对账结果给出编排会话的下一动作. 纯函数, 由 enter 与 status 使用.
 *
 * 下一动作写成编排会话可以照做的一句话: 回复哪种类型, 使用第几组选项,
 * 运行哪条命令. "运行 X" 指运行项目中的插件命令 `node <命令路径> X`.
 */

import { shortHash } from "./repo.mjs";

/**
 * 恢复命令在后续说明中的占位写法, 生成时替换为具体命令.
 * @type {string}
 */
const RESTORE_SLOT = "{restore}";

/**
 * 历史回退或分叉时的处理方式: 恢复记录, 用户自行恢复仓库, 或重新盘点.
 * @type {Readonly<{optionSet: number, followUp: string}>}
 */
const HISTORY_GUIDE = Object.freeze({
  optionSet: 1,
  followUp: `用户选 A 后${RESTORE_SLOT}; 选 B 后等用户恢复仓库, 再重新调用技能; 选 C 后运行 adopt, 再运行 stage 0 重新盘点`,
});

/**
 * 出现不认识的提交时的处理方式: 两个选项都纳入当前 HEAD.
 * @type {Readonly<{optionSet: number, followUp: string}>}
 */
const COMMIT_GUIDE = Object.freeze({
  optionSet: 2,
  followUp: "用户选 A 或 B 后运行 adopt",
});

/**
 * 需要用户在 "验收异常" 中选择处理方式的对账结果: 使用的选项组号与用户选择后的动作.
 * @type {Readonly<Record<string, {optionSet: number, followUp: string}>>}
 */
export const ANOMALY_GUIDES = Object.freeze({
  rollback: HISTORY_GUIDE,
  diverged: HISTORY_GUIDE,
  foreign: COMMIT_GUIDE,
  squash: COMMIT_GUIDE,
  mismatch: {
    optionSet: 3,
    followUp: `用户选 A 后运行 adopt; 选 B 后${RESTORE_SLOT}`,
  },
});

/**
 * @typedef {object} GuidanceInput 判断下一动作需要的信息.
 * @property {import("./state.mjs").NavigatorState} state 当前状态.
 * @property {import("./reconcile.mjs").ReconcileResult} reconciliation 对账结果.
 * @property {boolean} hasReceipt 当前工单的回执文件是否存在.
 * @property {boolean} isNewSession 本会话是否刚刚接管编排.
 * @property {string | undefined} restoreTarget 恢复记录时建议使用的提交.
 * @property {import("./spec.mjs").TemplateSpec} spec 模板规格, 用于写出回复类型的编号.
 */

/**
 * 写出 "回复某种类型" 这一步, 附上取骨架的命令, 编排会话不用再查编号.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {string} type 回复类型.
 * @param {number} [optionSet] 使用第几组选项; 省略时不写.
 * @returns {string} 例如 `回复 "验收异常", 使用第 1 组选项 (reply anomaly --option 1)`.
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
  const { state, reconciliation, isNewSession, spec } = input;
  if (Object.hasOwn(ANOMALY_GUIDES, reconciliation.kind)) {
    return anomalyAction(
      spec,
      ANOMALY_GUIDES[reconciliation.kind],
      input.restoreTarget,
    );
  }
  if (state.stage === null) {
    return replyStep(spec, "首次接入");
  }
  if (isNewSession) {
    return replyStep(spec, "恢复进度");
  }
  return state.order === null
    ? `继续阶段 ${state.stage} 的步骤 ${state.step}`
    : orderAction(spec, state.order, input.hasReceipt);
}

/**
 * 对账异常时的下一动作.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {{optionSet: number, followUp: string}} guide 处理方式.
 * @param {string | undefined} restoreTarget 建议恢复的提交.
 * @returns {string} 下一动作.
 */
function anomalyAction(spec, guide, restoreTarget) {
  const restore =
    restoreTarget === undefined
      ? "告知用户没有可用的恢复来源, 请改选其它选项"
      : `运行 restore ${shortHash(restoreTarget)}`;
  return `${replyStep(spec, "验收异常", guide.optionSet)}; ${guide.followUp.replace(RESTORE_SLOT, restore)}`;
}

/**
 * 当前有工单时, 按工单状态给出下一动作.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @param {{id: string, status: string}} order 当前工单.
 * @param {boolean} hasReceipt 回执文件是否存在.
 * @returns {string} 下一动作.
 */
function orderAction(spec, order, hasReceipt) {
  switch (order.status) {
    case "drafting":
      return `写完工单 ${order.id} 的 order.md, 运行 order set issued, 再${replyStep(spec, "工单发布")}`;
    case "issued":
      return hasReceipt
        ? `工单 ${order.id} 已有回执: 读回执; 执行受阻时运行 order set blocked 再${replyStep(spec, "受阻处理")}; 执行完成时, 测试或取证工具需要授权就${replyStep(spec, "测试授权")}, 否则运行 order set reviewing 并派验收子代理`
        : `等待工单 ${order.id} 的回执: ${replyStep(spec, "等待回执")}; 执行会话发来消息时, 把内容写入回执文件后再运行 status; 回执是否写入以 status 输出为准`;
    case "blocked":
      return `工单 ${order.id} 受阻: ${replyStep(spec, "受阻处理")}`;
    case "reviewing":
      return `工单 ${order.id} 验收中: 用 review-brief 的输出派验收子代理, 结论写入 review.md, 再${replyStep(spec, "验收报告")}`;
    case "accepted":
      return `工单 ${order.id} 已通过验收: ${replyStep(spec, "确认提交")}`;
    case "committing":
      return `工单 ${order.id} 正在提交: 确认提交完成后运行 order set committed`;
    default:
      return `工单 ${order.id} 处于未知状态 ${order.status}`;
  }
}
