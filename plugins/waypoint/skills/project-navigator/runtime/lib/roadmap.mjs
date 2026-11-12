/**
 * @file 路线: 里程与切片的查询, 路线草稿的合并, 里程完成与项目收尾.
 *
 * 所有函数都不修改传入的状态, 返回新状态. 不合法的操作抛出 WorkflowError.
 */

import { allocateNumber } from "./numbering.mjs";
import {
  MILESTONE_STATUSES,
  SLICE_KINDS,
  SLICE_KIND_LABELS,
  SLICE_STATUSES,
  STAGES,
} from "./state.mjs";
import { requireLabel, requireText } from "./validation.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 已经结束, 不再推进的切片状态.
 * @type {readonly string[]}
 */
const SETTLED_SLICE_STATUSES = Object.freeze([
  SLICE_STATUSES.done,
  SLICE_STATUSES.dropped,
]);

/**
 * @typedef {import("./state.mjs").NavigatorState} NavigatorState
 * @typedef {import("./state.mjs").MilestoneState} MilestoneState
 * @typedef {import("./state.mjs").SliceState} SliceState
 */

/**
 * @typedef {object} RoadmapDraft 路线草稿.
 * @property {{id?: string, name: string, goal: string, slices?: {id?: string, name: string, kind?: string, interactive?: boolean}[]}[]} milestones 里程.
 */

/**
 * 判断切片是否已经结束.
 *
 * @param {SliceState} slice 切片.
 * @returns {boolean} 已完成或已放弃时返回 true.
 */
export function isSliceSettled(slice) {
  return SETTLED_SLICE_STATUSES.includes(slice.status);
}

/**
 * 取当前里程: 第一个没有完成的里程.
 *
 * @param {NavigatorState} state 状态.
 * @returns {MilestoneState | undefined} 当前里程; 全部完成或还没有路线时为 undefined.
 */
export function currentMilestone(state) {
  return state.milestones.find(
    (milestone) => milestone.status !== MILESTONE_STATUSES.done,
  );
}

/**
 * 按编号查找切片.
 *
 * @param {NavigatorState} state 状态.
 * @param {string} id 切片编号.
 * @returns {{milestone: MilestoneState, slice: SliceState} | undefined} 切片及其所在里程.
 */
export function findSlice(state, id) {
  for (const milestone of state.milestones) {
    const slice = milestone.slices.find((entry) => entry.id === id);
    if (slice !== undefined) {
      return { milestone, slice };
    }
  }
  return undefined;
}

/**
 * 取进行中的切片.
 *
 * @param {NavigatorState} state 状态.
 * @returns {{milestone: MilestoneState, slice: SliceState} | undefined} 进行中的切片及其所在里程.
 */
export function activeSlice(state) {
  return state.current === null
    ? undefined
    : findSlice(state, state.current.sliceId);
}

/**
 * 取当前里程中第一个还没有开始的切片.
 *
 * @param {NavigatorState} state 状态.
 * @returns {SliceState | undefined} 切片; 没有时为 undefined.
 */
export function nextPendingSlice(state) {
  return currentMilestone(state)?.slices.find(
    (slice) => slice.status === SLICE_STATUSES.pending,
  );
}

/**
 * 判断里程中的切片是否全部结束.
 *
 * @param {MilestoneState} milestone 里程.
 * @returns {boolean} 至少有一个切片, 且全部已完成或已放弃时返回 true.
 */
export function isMilestoneSettled(milestone) {
  return milestone.slices.length > 0 && milestone.slices.every(isSliceSettled);
}

/**
 * 取最小骨架切片.
 *
 * @param {NavigatorState} state 状态.
 * @returns {SliceState | undefined} 骨架切片.
 */
export function skeletonSlice(state) {
  return state.milestones
    .flatMap((milestone) => milestone.slices)
    .find((slice) => slice.skeleton);
}

/**
 * 替换某个切片的字段.
 *
 * @param {NavigatorState} state 状态.
 * @param {string} id 切片编号.
 * @param {Partial<SliceState>} patch 要替换的字段.
 * @returns {MilestoneState[]} 新的里程列表.
 */
export function patchSlice(state, id, patch) {
  return state.milestones.map((milestone) => ({
    ...milestone,
    slices: milestone.slices.map((slice) =>
      slice.id === id ? { ...slice, ...patch } : slice,
    ),
  }));
}

/**
 * 把路线草稿合并进状态. 已有的里程与切片凭编号保留; 已经开始的切片原样保留,
 * 不能删除. 第一个里程的第一个切片是最小骨架.
 *
 * @param {NavigatorState} state 状态.
 * @param {RoadmapDraft} draft 路线草稿.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 草稿不合法时.
 */
export function applyRoadmap(state, draft) {
  if (!Array.isArray(draft?.milestones) || draft.milestones.length === 0) {
    throw new WorkflowError(
      '路线草稿的格式: {"milestones": [{"name", "goal", "slices": [{"name", "kind", "interactive"}]}]}, 至少一个里程.',
    );
  }
  if (
    state.project.organization === null ||
    state.project.verification === null
  ) {
    throw new WorkflowError(
      "还没有登记模块组织方式与验证方式, 请先运行 setup.",
    );
  }
  let counters = state.next;
  const milestones = draft.milestones.map((entry) => {
    const merged = mergeMilestone(state, entry, counters);
    counters = merged.next;
    return merged.milestone;
  });
  assertNothingLost(state, milestones);
  const marked = markStatuses(markSkeleton(state, milestones));
  const first = marked.find(
    (milestone) => milestone.status === MILESTONE_STATUSES.active,
  );
  if (first !== undefined && first.slices.length === 0) {
    throw new WorkflowError(
      `里程 ${first.id} 是当前里程, 要排出它的全部切片; 之后的里程可以只写名称与目标.`,
    );
  }
  return {
    ...state,
    stage: first === undefined ? state.stage : STAGES.slicing,
    milestones: marked,
    next: counters,
    lastAction: "更新路线",
  };
}

/**
 * 把当前里程标为完成, 下一个里程成为当前里程.
 *
 * @param {NavigatorState} state 状态.
 * @param {string | undefined} id 里程编号.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 编号不是当前里程, 或里程中还有没结束的切片时.
 */
export function completeMilestone(state, id) {
  const milestone = currentMilestone(state);
  if (milestone === undefined || milestone.id !== id) {
    throw new WorkflowError(
      milestone === undefined
        ? "没有进行中的里程."
        : `当前里程是 ${milestone.id}, 用法: milestone done ${milestone.id}.`,
    );
  }
  if (!isMilestoneSettled(milestone)) {
    throw new WorkflowError(
      `里程 ${milestone.id} 还有没结束的切片, 全部通过或放弃后才能完成.`,
    );
  }
  const milestones = markStatuses(
    state.milestones.map((entry) =>
      entry.id === id ? { ...entry, status: MILESTONE_STATUSES.done } : entry,
    ),
  );
  return {
    ...state,
    milestones,
    lastAction: `里程 ${id} 完成`,
  };
}

/**
 * 确认项目收尾.
 *
 * @param {NavigatorState} state 状态.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 还有没完成的里程时.
 */
export function finishProject(state) {
  const milestone = currentMilestone(state);
  if (state.milestones.length === 0 || milestone !== undefined) {
    throw new WorkflowError(
      milestone === undefined
        ? "还没有路线, 不能收尾."
        : `里程 ${milestone.id} 还没有完成, 不能收尾.`,
    );
  }
  return { ...state, stage: STAGES.finished, lastAction: "项目收尾" };
}

/**
 * 合并草稿中的一个里程.
 *
 * @param {NavigatorState} state 状态.
 * @param {RoadmapDraft["milestones"][number]} entry 草稿中的里程.
 * @param {Record<string, number>} counters 编号计数器.
 * @returns {{milestone: MilestoneState, next: Record<string, number>}} 合并后的里程与新计数器.
 * @throws {WorkflowError} 编号不存在, 或向已完成的里程加切片时.
 */
function mergeMilestone(state, entry, counters) {
  const existing =
    entry.id === undefined
      ? undefined
      : state.milestones.find((milestone) => milestone.id === entry.id);
  if (entry.id !== undefined && existing === undefined) {
    throw new WorkflowError(
      `里程 ${entry.id} 不存在; 新里程不写 id, 由脚本分配.`,
    );
  }
  const allocated =
    existing === undefined ? allocateNumber(counters, "milestone") : undefined;
  let next = allocated?.next ?? counters;
  const slices = (entry.slices ?? []).map((draft) => {
    const merged = mergeSlice(state, draft, next);
    next = merged.next;
    return merged.slice;
  });
  const isDone = existing?.status === MILESTONE_STATUSES.done;
  if (isDone && !slices.every(isSliceSettled)) {
    throw new WorkflowError(
      `里程 ${entry.id} 已经完成, 不能再加切片; 新的工作排进之后的里程.`,
    );
  }
  return {
    milestone: {
      id: existing?.id ?? /** @type {{id: string}} */ (allocated).id,
      name: requireText(entry.name, "里程名称"),
      goal: requireText(entry.goal, "里程目标"),
      status: isDone ? MILESTONE_STATUSES.done : MILESTONE_STATUSES.pending,
      slices,
    },
    next,
  };
}

/**
 * 合并草稿中的一个切片: 已经开始的切片原样保留, 还没有开始的按草稿更新.
 *
 * @param {NavigatorState} state 状态.
 * @param {{id?: string, name: string, kind?: string, interactive?: boolean}} draft 草稿中的切片.
 * @param {Record<string, number>} counters 编号计数器.
 * @returns {{slice: SliceState, next: Record<string, number>}} 合并后的切片与新计数器.
 * @throws {WorkflowError} 编号不存在, 种类不合法, 或改代码的切片被标为交互式时.
 */
function mergeSlice(state, draft, counters) {
  const existing =
    draft.id === undefined ? undefined : findSlice(state, draft.id)?.slice;
  if (draft.id !== undefined && existing === undefined) {
    throw new WorkflowError(
      `切片 ${draft.id} 不存在; 新切片不写 id, 由脚本分配.`,
    );
  }
  if (existing !== undefined && existing.status !== SLICE_STATUSES.pending) {
    return { slice: existing, next: counters };
  }
  const kind = requireLabel(
    draft.kind ?? SLICE_KINDS.build,
    SLICE_KIND_LABELS,
    "切片种类 (kind)",
  );
  const isInteractive = draft.interactive ?? kind === SLICE_KINDS.findings;
  if (isInteractive && kind === SLICE_KINDS.build) {
    throw new WorkflowError(
      `切片 "${draft.name}": 改代码的切片不能是交互式, 需要用户亲手验证的部分放在验收之后.`,
    );
  }
  const allocated =
    existing === undefined ? allocateNumber(counters, "slice") : undefined;
  return {
    slice: {
      id: existing?.id ?? /** @type {{id: string}} */ (allocated).id,
      name: requireText(draft.name, "切片名称"),
      kind,
      skeleton: false,
      interactive: isInteractive,
      status: SLICE_STATUSES.pending,
      file: null,
    },
    next: allocated?.next ?? counters,
  };
}

/**
 * 确认草稿没有丢掉已完成的里程与已经开始的切片.
 *
 * @param {NavigatorState} state 合并前的状态.
 * @param {readonly MilestoneState[]} milestones 合并后的里程.
 * @returns {void}
 * @throws {WorkflowError} 有里程或切片被丢掉时.
 */
function assertNothingLost(state, milestones) {
  const keptMilestones = milestones.map((milestone) => milestone.id);
  const keptSlices = milestones
    .flatMap((milestone) => milestone.slices)
    .map((slice) => slice.id);
  const lostMilestone = state.milestones.find(
    (milestone) =>
      milestone.status === MILESTONE_STATUSES.done &&
      !keptMilestones.includes(milestone.id),
  );
  if (lostMilestone !== undefined) {
    throw new WorkflowError(
      `草稿中缺少已完成的里程 ${lostMilestone.id}: 已有的里程带上 id 原样保留.`,
    );
  }
  const lostSlice = state.milestones
    .flatMap((milestone) => milestone.slices)
    .find(
      (slice) =>
        slice.status !== SLICE_STATUSES.pending &&
        !keptSlices.includes(slice.id),
    );
  if (lostSlice !== undefined) {
    throw new WorkflowError(
      `草稿中缺少已经开始的切片 ${lostSlice.id}: 已有的切片带上 id 原样保留; 不想做了用 slice drop.`,
    );
  }
}

/**
 * 标出最小骨架: 骨架已经开始时保持不变, 否则取第一个里程的第一个切片.
 *
 * @param {NavigatorState} state 合并前的状态.
 * @param {readonly MilestoneState[]} milestones 合并后的里程.
 * @returns {MilestoneState[]} 标好骨架的里程.
 * @throws {WorkflowError} 第一个切片不是改代码的切片时.
 */
function markSkeleton(state, milestones) {
  const started = skeletonSlice(state);
  const isFixed =
    started !== undefined && started.status !== SLICE_STATUSES.pending;
  const skeletonId = isFixed ? started.id : milestones[0].slices[0]?.id;
  const marked = milestones.map((milestone) => ({
    ...milestone,
    slices: milestone.slices.map((slice) => ({
      ...slice,
      skeleton: slice.id === skeletonId,
    })),
  }));
  const skeleton = marked
    .flatMap((milestone) => milestone.slices)
    .find((slice) => slice.skeleton);
  if (skeleton !== undefined && skeleton.kind !== SLICE_KINDS.build) {
    throw new WorkflowError(
      `第一个里程的第一个切片 "${skeleton.name}" 是最小骨架, 种类必须是 ${SLICE_KINDS.build}: 它要从真实入口跑通. 需要先查清的事排在骨架之后, 或在立项时查清.`,
    );
  }
  return marked;
}

/**
 * 重新标出里程状态: 已完成的不变, 第一个没完成的为进行中, 其余为未开始.
 *
 * @param {readonly MilestoneState[]} milestones 里程.
 * @returns {MilestoneState[]} 标好状态的里程.
 */
function markStatuses(milestones) {
  const active = milestones.find(
    (milestone) => milestone.status !== MILESTONE_STATUSES.done,
  );
  return milestones.map((milestone) => ({
    ...milestone,
    status:
      milestone.status === MILESTONE_STATUSES.done
        ? MILESTONE_STATUSES.done
        : milestone.id === active?.id
          ? MILESTONE_STATUSES.active
          : MILESTONE_STATUSES.pending,
  }));
}
