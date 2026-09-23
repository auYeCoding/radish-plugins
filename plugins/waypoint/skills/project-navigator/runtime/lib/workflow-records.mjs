/**
 * @file 风险, 决策与变更的状态管理. 所有函数都返回新状态, 不修改传入的状态.
 *
 * 这些条目的状态与编号只存在 `state.json` 中; 风险表格整份由脚本生成,
 * 决策与变更的正文由编排会话写在对应的记录文件里, 以编号对应.
 */

import { allocateNumber } from "./numbering.mjs";
import { requireLabel, requireText } from "./validation.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 风险严重程度及显示用的中文.
 * @type {Readonly<Record<string, string>>}
 */
export const RISK_SEVERITY_LABELS = Object.freeze({
  high: "高",
  medium: "中",
  low: "低",
});

/**
 * 风险状态及显示用的中文.
 * @type {Readonly<Record<string, string>>}
 */
export const RISK_STATUS_LABELS = Object.freeze({
  open: "待处理",
  investigating: "调研中",
  resolved: "已处理",
  accepted: "已接受",
});

/**
 * 决策状态及显示用的中文.
 * @type {Readonly<Record<string, string>>}
 */
export const DECISION_STATUS_LABELS = Object.freeze({
  approved: "已批准",
  superseded: "已取代",
});

/**
 * 变更状态及显示用的中文.
 * @type {Readonly<Record<string, string>>}
 */
export const CHANGE_STATUS_LABELS = Object.freeze({
  accepted: "已接受",
  deferred: "已延后",
  dropped: "已放弃",
});

/**
 * 新增一条风险.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {{description: string, severity: string, source: string, handling?: string}} draft 风险草稿.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 草稿字段不合法时.
 */
export function addRisk(state, draft) {
  requireLabel(draft.severity, RISK_SEVERITY_LABELS, "严重程度");
  const { id, next } = allocateNumber(state.next, "risk");
  const risk = {
    id,
    description: requireText(draft.description, "风险描述"),
    severity: draft.severity,
    source: requireText(draft.source, "风险来源"),
    status: "open",
    handling: draft.handling?.trim() || "无",
  };
  return {
    ...state,
    next,
    risks: [...state.risks, risk],
    lastAction: `新增风险 ${id}`,
  };
}

/**
 * 更新风险的状态与处理方式.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} id 风险编号.
 * @param {string} status 新状态.
 * @param {string | undefined} handling 处理方式; 省略时保留原值.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 编号不存在或状态不合法时.
 */
export function setRiskStatus(state, id, status, handling) {
  requireLabel(status, RISK_STATUS_LABELS, "风险状态");
  requireExisting(state.risks, id, "风险");
  return {
    ...state,
    risks: state.risks.map((risk) =>
      risk.id === id
        ? { ...risk, status, handling: handling?.trim() || risk.handling }
        : risk,
    ),
    lastAction: `风险 ${id} 转为 ${RISK_STATUS_LABELS[status]}`,
  };
}

/**
 * 新增一条已批准的决策, 并返回其编号供编排会话写入决策记录.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} title 决策标题.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 标题为空时.
 */
export function addDecision(state, title) {
  const { id, next } = allocateNumber(state.next, "decision");
  const decision = {
    id,
    title: requireText(title, "决策标题"),
    status: "approved",
  };
  return {
    ...state,
    next,
    decisions: [...state.decisions, decision],
    lastAction: `新增决策 ${id}`,
  };
}

/**
 * 把一条决策标为被另一条取代.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} id 被取代的决策编号.
 * @param {string} replacementId 取代它的决策编号.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 任一编号不存在时.
 */
export function supersedeDecision(state, id, replacementId) {
  requireExisting(state.decisions, id, "决策");
  requireExisting(state.decisions, replacementId, "决策");
  return {
    ...state,
    decisions: state.decisions.map((decision) =>
      decision.id === id
        ? { ...decision, status: "superseded", supersededBy: replacementId }
        : decision,
    ),
    lastAction: `决策 ${id} 被决策 ${replacementId} 取代`,
  };
}

/**
 * 新增一条变更, 状态为用户的处理结果.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} title 变更标题.
 * @param {string} status 变更状态.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 标题为空或状态不合法时.
 */
export function addChange(state, title, status) {
  requireLabel(status, CHANGE_STATUS_LABELS, "变更状态");
  const { id, next } = allocateNumber(state.next, "change");
  const change = { id, title: requireText(title, "变更标题"), status };
  return {
    ...state,
    next,
    changes: [...state.changes, change],
    lastAction: `新增变更 ${id}`,
  };
}

/**
 * 分配一个体检编号, 供编排会话写入体检记录.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {{id: string, state: import("./state.mjs").NavigatorState}} 新编号与新状态.
 */
export function addCheckup(state) {
  const { id, next } = allocateNumber(state.next, "checkup");
  return { id, state: { ...state, next, lastAction: `完成体检 ${id}` } };
}

/**
 * 确认编号在列表中存在.
 *
 * @param {{id: string}[]} list 条目列表.
 * @param {string} id 编号.
 * @param {string} label 类别名, 用于错误信息.
 * @returns {void}
 * @throws {WorkflowError} 编号不存在时.
 */
function requireExisting(list, id, label) {
  if (!list.some((entry) => entry.id === id)) {
    throw new WorkflowError(`${label} ${id} 不存在.`);
  }
}
