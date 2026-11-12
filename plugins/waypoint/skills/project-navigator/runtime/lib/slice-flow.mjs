/**
 * @file 切片的状态转换: 写计划, 开工, 更新计划, 送验, 通过, 补做, 放弃.
 *
 * 同一时间只有一个切片在进行, 它的运行信息记在状态的 `current` 中. 所有函数都
 * 不修改传入的状态, 返回新状态. 不合法的操作抛出 WorkflowError.
 */

import {
  activeSlice,
  currentMilestone,
  patchSlice,
  skeletonSlice,
} from "./roadmap.mjs";
import { SLICE_STATUSES, SLICE_STATUS_LABELS } from "./state.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 第一轮的轮次.
 * @type {number}
 */
const FIRST_ROUND = 1;

/**
 * @typedef {import("./state.mjs").NavigatorState} NavigatorState
 * @typedef {import("./state.mjs").SliceState} SliceState
 */

/**
 * 为一个还没有开始的切片建计划.
 *
 * @param {NavigatorState} state 状态.
 * @param {string | undefined} id 切片编号.
 * @param {string} file 切片文件的项目相对路径.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 已有进行中的切片, 切片不在当前里程, 或骨架还没有通过时.
 */
export function planSlice(state, id, file) {
  const active = activeSlice(state);
  if (active !== undefined) {
    throw new WorkflowError(
      `切片 ${active.slice.id} 还在进行 (${SLICE_STATUS_LABELS[active.slice.status]}), 同一时间只做一个切片; 它通过或放弃后再开始下一个.`,
    );
  }
  const milestone = currentMilestone(state);
  const slice = milestone?.slices.find((entry) => entry.id === id);
  if (slice === undefined || slice.status !== SLICE_STATUSES.pending) {
    const pending = (milestone?.slices ?? [])
      .filter((entry) => entry.status === SLICE_STATUSES.pending)
      .map((entry) => entry.id);
    throw new WorkflowError(
      `slice plan 的用法: slice plan <编号> --slug <短名>, 编号是当前里程中还没有开始的切片${pending.length === 0 ? "; 当前里程没有这样的切片" : `: ${pending.join(", ")}`}.`,
    );
  }
  const skeleton = skeletonSlice(state);
  if (
    skeleton !== undefined &&
    skeleton.id !== slice.id &&
    skeleton.status !== SLICE_STATUSES.done
  ) {
    throw new WorkflowError(
      `最小骨架 (切片 ${skeleton.id}) 还没有通过验收, 先做它: 骨架跑通之前不做其它切片.`,
    );
  }
  return {
    ...state,
    milestones: patchSlice(state, slice.id, {
      status: SLICE_STATUSES.planned,
      file,
    }),
    current: {
      sliceId: slice.id,
      baseCommit: null,
      planDigest: null,
      round: FIRST_ROUND,
    },
    lastAction: `切片 ${slice.id} 开始写计划`,
  };
}

/**
 * 开工: 记下基准提交与计划段的摘要.
 *
 * @param {NavigatorState} state 状态.
 * @param {{baseCommit: string, planDigest: string}} facts 开工时的提交与计划摘要.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 没有处于计划中的切片时.
 */
export function startSlice(state, { baseCommit, planDigest }) {
  const slice = requireActive(state, [SLICE_STATUSES.planned], "slice start");
  return move(state, slice, SLICE_STATUSES.running, {
    current: { baseCommit, planDigest },
    lastAction: `切片 ${slice.id} 开工`,
  });
}

/**
 * 实现期间计划有改动时, 重新记下计划段的摘要.
 *
 * @param {NavigatorState} state 状态.
 * @param {string} planDigest 新的计划摘要.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 没有处于实现中的切片时.
 */
export function refreshPlan(state, planDigest) {
  const slice = requireActive(state, [SLICE_STATUSES.running], "slice replan");
  return move(state, slice, SLICE_STATUSES.running, {
    current: { planDigest },
    lastAction: `切片 ${slice.id} 更新计划`,
  });
}

/**
 * 送验.
 *
 * @param {NavigatorState} state 状态.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 没有处于实现中的切片时.
 */
export function reviewSlice(state) {
  const slice = requireActive(state, [SLICE_STATUSES.running], "slice review");
  return move(state, slice, SLICE_STATUSES.reviewing, {
    lastAction: `切片 ${slice.id} 送验`,
  });
}

/**
 * 验收通过, 切片结束.
 *
 * @param {NavigatorState} state 状态.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 没有处于验收中的切片时.
 */
export function acceptSlice(state) {
  const slice = requireActive(
    state,
    [SLICE_STATUSES.reviewing],
    "slice accept",
  );
  return settle(state, slice, SLICE_STATUSES.done, `切片 ${slice.id} 通过`);
}

/**
 * 补做: 回到实现中, 轮次加一, 记下补做内容写入后的计划摘要.
 *
 * @param {NavigatorState} state 状态.
 * @param {string} planDigest 新的计划摘要.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 没有处于验收中的切片时.
 */
export function redoSlice(state, planDigest) {
  const slice = requireActive(state, [SLICE_STATUSES.reviewing], "slice redo");
  const round = /** @type {{round: number}} */ (state.current).round + 1;
  return move(state, slice, SLICE_STATUSES.running, {
    current: { planDigest, round },
    lastAction: `切片 ${slice.id} 补做, 第 ${round} 轮`,
  });
}

/**
 * 放弃进行中的切片. 最小骨架不能放弃.
 *
 * @param {NavigatorState} state 状态.
 * @returns {NavigatorState} 新状态.
 * @throws {WorkflowError} 没有进行中的切片, 或它是最小骨架时.
 */
export function dropSlice(state) {
  const slice = requireActive(
    state,
    [SLICE_STATUSES.planned, SLICE_STATUSES.running, SLICE_STATUSES.reviewing],
    "slice drop",
  );
  if (slice.skeleton) {
    throw new WorkflowError(
      `切片 ${slice.id} 是最小骨架, 不能放弃: 之后的切片都建立在它之上. 做不下去时补做, 或用需求变更重排路线.`,
    );
  }
  return settle(state, slice, SLICE_STATUSES.dropped, `切片 ${slice.id} 放弃`);
}

/**
 * 取进行中的切片, 并确认它处于允许的状态.
 *
 * @param {NavigatorState} state 状态.
 * @param {readonly string[]} allowed 允许的状态.
 * @param {string} command 命令名, 用于错误信息.
 * @returns {SliceState} 进行中的切片.
 * @throws {WorkflowError} 没有进行中的切片, 或状态不在允许范围内时.
 */
function requireActive(state, allowed, command) {
  const slice = activeSlice(state)?.slice;
  if (slice === undefined) {
    throw new WorkflowError(
      `没有进行中的切片, 不能运行 ${command}; 先用 slice plan 为一个切片建计划.`,
    );
  }
  if (!allowed.includes(slice.status)) {
    throw new WorkflowError(
      `切片 ${slice.id} 现在是 "${SLICE_STATUS_LABELS[slice.status]}", ${command} 要求它是 ${allowed.map((status) => `"${SLICE_STATUS_LABELS[status]}"`).join(" 或 ")}.`,
    );
  }
  return slice;
}

/**
 * 把进行中的切片转到新状态, 并更新运行信息.
 *
 * @param {NavigatorState} state 状态.
 * @param {SliceState} slice 进行中的切片.
 * @param {string} status 新状态.
 * @param {{current?: Partial<import("./state.mjs").CurrentSlice>, lastAction: string}} changes 运行信息中要替换的字段与动作描述.
 * @returns {NavigatorState} 新状态.
 */
function move(state, slice, status, { current = {}, lastAction }) {
  return {
    ...state,
    milestones: patchSlice(state, slice.id, { status }),
    current: {
      .../** @type {import("./state.mjs").CurrentSlice} */ (state.current),
      ...current,
    },
    lastAction,
  };
}

/**
 * 结束进行中的切片.
 *
 * @param {NavigatorState} state 状态.
 * @param {SliceState} slice 进行中的切片.
 * @param {string} status 结束时的状态.
 * @param {string} lastAction 动作描述.
 * @returns {NavigatorState} 新状态.
 */
function settle(state, slice, status, lastAction) {
  return {
    ...state,
    milestones: patchSlice(state, slice.id, { status }),
    current: null,
    lastAction,
  };
}
