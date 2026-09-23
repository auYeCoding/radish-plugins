/**
 * @file 阶段, 步骤, 里程与切片的状态转换. 所有函数都返回新状态, 不修改传入的状态.
 */

import { allocateNumber } from "./numbering.mjs";
import { requireText } from "./validation.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 里程与切片的状态, 以及显示用的中文.
 * @type {Readonly<Record<string, string>>}
 */
export const PROGRESS_STATUS_LABELS = Object.freeze({
  pending: "未开始",
  active: "进行中",
  done: "已完成",
});

/**
 * 步骤标识的格式: 小写字母, 数字与连字符.
 * @type {RegExp}
 */
const STEP_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * @typedef {object} RoadmapDraft 推进路线草稿: 编排会话写在 drafts/ 中的 JSON.
 * @property {{id?: string, name: string, goal: string, metrics: string[], slices: {id?: string, name: string}[]}[]} milestones 里程及其切片, 按顺序.
 */

/**
 * 进入某个阶段, 步骤重置为 start.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {number} stage 阶段编号.
 * @param {number} lastStage 最后一个阶段的编号, 取自模板规格.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 阶段编号不合法时.
 */
export function enterStage(state, stage, lastStage) {
  requireStage(stage, lastStage);
  return { ...state, stage, step: "start", lastAction: `进入阶段 ${stage}` };
}

/**
 * 设置当前阶段内的步骤.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} step 步骤标识.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 步骤标识不合法时.
 */
export function setStep(state, step) {
  if (!STEP_PATTERN.test(step)) {
    throw new WorkflowError("步骤标识只能使用小写字母, 数字与连字符.");
  }
  return { ...state, step, lastAction: `步骤 ${step}` };
}

/**
 * 记录跳过某个阶段及原因. 跳过必须由用户认可, 原因必须写明.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {number} stage 被跳过的阶段编号.
 * @param {string} reason 跳过原因.
 * @param {object} options 其它参数.
 * @param {number} options.lastStage 最后一个阶段的编号, 取自模板规格.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 原因为空或阶段编号不合法时.
 */
export function skipStage(state, stage, reason, { lastStage, now }) {
  if (reason.trim() === "") {
    throw new WorkflowError("跳过阶段必须写明原因.");
  }
  requireStage(stage, lastStage);
  return {
    ...state,
    skipped: [
      ...state.skipped,
      { stage, reason: reason.trim(), approvedAt: now },
    ],
    lastAction: `跳过阶段 ${stage}`,
  };
}

/**
 * 按草稿更新推进路线: 带编号的里程与切片保留原状态, 不带编号的分配新编号.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {RoadmapDraft} draft 推进路线草稿.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 草稿结构不合法, 或引用了不存在的编号时.
 */
export function applyRoadmap(state, draft) {
  if (!Array.isArray(draft?.milestones) || draft.milestones.length === 0) {
    throw new WorkflowError("推进路线草稿至少要有一个里程.");
  }
  let next = state.next;
  const milestones = [];
  const slices = [];
  for (const milestoneDraft of draft.milestones) {
    const milestone = resolveEntry(
      state.milestones,
      milestoneDraft,
      next,
      "milestone",
    );
    next = milestone.next;
    milestones.push({
      id: milestone.id,
      name: requireText(milestoneDraft.name, "里程名称"),
      goal: requireText(milestoneDraft.goal, "里程目标"),
      metrics: Array.isArray(milestoneDraft.metrics)
        ? milestoneDraft.metrics
        : [],
      status: milestone.existing?.status ?? "pending",
    });
    for (const sliceDraft of milestoneDraft.slices ?? []) {
      const slice = resolveEntry(state.slices, sliceDraft, next, "slice");
      next = slice.next;
      slices.push({
        id: slice.id,
        milestone: milestone.id,
        name: requireText(sliceDraft.name, "切片名称"),
        status: slice.existing?.status ?? "pending",
        orders: slice.existing?.orders ?? [],
      });
    }
  }
  return { ...state, next, milestones, slices, lastAction: "更新推进路线" };
}

/**
 * 设置里程或切片的状态; 设为进行中时同时成为当前里程或切片.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {"milestone" | "slice"} kind 类别.
 * @param {string} id 编号.
 * @param {string} status 状态: pending, active 或 done.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 编号不存在或状态不合法时.
 */
export function setProgressStatus(state, kind, id, status) {
  if (!Object.hasOwn(PROGRESS_STATUS_LABELS, status)) {
    throw new WorkflowError(
      `状态应为 ${Object.keys(PROGRESS_STATUS_LABELS).join(", ")} 之一.`,
    );
  }
  const listKey = kind === "milestone" ? "milestones" : "slices";
  if (!state[listKey].some((entry) => entry.id === id)) {
    throw new WorkflowError(
      `${kind === "milestone" ? "里程" : "切片"} ${id} 不存在.`,
    );
  }
  const list = state[listKey].map((entry) =>
    entry.id === id ? { ...entry, status } : entry,
  );
  const pointer = status === "active" ? id : state[kind];
  return {
    ...state,
    [listKey]: list,
    [kind]: pointer,
    lastAction: `${kind === "milestone" ? "里程" : "切片"} ${id} 转为 ${PROGRESS_STATUS_LABELS[status]}`,
  };
}

/**
 * 确认阶段编号合法.
 *
 * @param {number} stage 阶段编号.
 * @param {number} lastStage 最后一个阶段的编号.
 * @returns {void}
 * @throws {WorkflowError} 阶段编号不合法时.
 */
function requireStage(stage, lastStage) {
  if (!Number.isInteger(stage) || stage < 0 || stage > lastStage) {
    throw new WorkflowError(`阶段编号应为 0 至 ${lastStage} 的整数.`);
  }
}

/**
 * 找到草稿条目对应的已有条目, 或为新条目分配编号.
 *
 * @param {{id: string}[]} existingList 已有条目.
 * @param {{id?: string}} draftEntry 草稿条目.
 * @param {Record<string, number>} next 计数器.
 * @param {string} kind 编号类别.
 * @returns {{id: string, existing: Record<string, any> | undefined, next: Record<string, number>}} 编号, 已有条目与计数器.
 * @throws {WorkflowError} 草稿引用了不存在的编号时.
 */
function resolveEntry(existingList, draftEntry, next, kind) {
  if (draftEntry.id === undefined) {
    const allocated = allocateNumber(next, kind);
    return { id: allocated.id, existing: undefined, next: allocated.next };
  }
  const existing = existingList.find((entry) => entry.id === draftEntry.id);
  if (existing === undefined) {
    throw new WorkflowError(
      `草稿中的编号 ${draftEntry.id} 不存在; 新条目请不写编号.`,
    );
  }
  return { id: existing.id, existing, next };
}
