/**
 * @file 工单的状态转换. 所有函数都返回新状态, 不修改传入的状态.
 *
 * 状态流转:
 * drafting (起草) → issued (已发布) → reviewing (验收中) → accepted (已通过)
 * → committing (提交中) → committed (已提交).
 * issued 可转为 blocked (受阻), blocked 修改后重新 issued; 验收不通过为 rejected;
 * 任何未结束的工单都可以 voided (作废). committed, rejected, voided 是结束状态,
 * 结束的工单移入历史, 当前工单清空.
 */

import { allocateNumber } from "./numbering.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 工单状态及允许转入的下一状态.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ORDER_TRANSITIONS = Object.freeze({
  drafting: ["issued", "voided"],
  issued: ["reviewing", "blocked", "voided"],
  blocked: ["issued", "voided"],
  reviewing: ["accepted", "rejected"],
  accepted: ["committing", "committed"],
  committing: ["committed", "accepted"],
});

/**
 * 结束状态: 工单进入这些状态后移入历史.
 * @type {readonly string[]}
 */
export const TERMINAL_ORDER_STATUSES = Object.freeze([
  "committed",
  "rejected",
  "voided",
]);

/**
 * 工单类型.
 * @type {readonly string[]}
 */
export const ORDER_KINDS = Object.freeze([
  "implementation",
  "selection",
  "runcheck",
  "fix",
]);

/**
 * 工单短名的格式: 小写字母, 数字与连字符.
 * @type {RegExp}
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * 新建工单, 成为当前工单. 工单严格串行: 已有未结束的工单时不能新建.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {object} options 工单参数.
 * @param {string} options.kind 工单类型.
 * @param {string} options.slug 文件夹短名.
 * @param {string | undefined} options.slice 所属切片编号.
 * @param {string} options.baseCommit 基准提交.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 已有进行中的工单, 或参数不合法时.
 */
export function createOrder(state, { kind, slug, slice, baseCommit }) {
  if (state.order !== null) {
    throw new WorkflowError(
      `工单 ${state.order.id} 尚未结束 (${state.order.status}), 工单必须逐张完成.`,
    );
  }
  if (!ORDER_KINDS.includes(kind)) {
    throw new WorkflowError(`工单类型应为 ${ORDER_KINDS.join(", ")} 之一.`);
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new WorkflowError(
      "工单短名只能使用小写字母, 数字与连字符, 例如 export-csv.",
    );
  }
  if (
    slice !== undefined &&
    !state.slices.some((entry) => entry.id === slice)
  ) {
    throw new WorkflowError(`切片 ${slice} 不存在.`);
  }
  const { id, next } = allocateNumber(state.next, "order");
  return {
    ...state,
    next,
    order: {
      id,
      slug,
      folder: `${id}-${slug}`,
      kind,
      slice: slice ?? null,
      status: "drafting",
      round: 0,
      baseCommit,
      authorizedTests: [],
    },
    lastAction: `新建工单 ${id}`,
  };
}

/**
 * 转换当前工单的状态; 每次发布时发布轮次加一, 执行会话需要就新一轮重新对齐;
 * 进入结束状态时移入历史, 提交时记录最近提交.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} status 目标状态.
 * @param {string | undefined} head 当前 HEAD, 进入 committed 时必须提供.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有当前工单或转换不合法时.
 */
export function setOrderStatus(state, status, head) {
  const order = state.order;
  if (order === null) {
    throw new WorkflowError("当前没有工单.");
  }
  const allowed = ORDER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    throw new WorkflowError(
      `工单 ${order.id} 不能从 ${order.status} 转为 ${status}; 允许的下一状态: ${allowed.join(", ") || "无"}.`,
    );
  }
  if (status === "committed" && head === undefined) {
    throw new WorkflowError("仓库没有 HEAD 提交, 无法记录提交.");
  }
  const updated =
    status === "issued"
      ? { ...order, status, round: (order.round ?? 0) + 1 }
      : { ...order, status };
  if (!TERMINAL_ORDER_STATUSES.includes(status)) {
    return {
      ...state,
      order: updated,
      lastAction: `工单 ${order.id} 转为 ${status}`,
    };
  }
  return {
    ...state,
    order: null,
    orders: [...(state.orders ?? []), summarizeOrder(updated)],
    slices: state.slices.map((slice) =>
      slice.id === order.slice
        ? { ...slice, orders: [...(slice.orders ?? []), order.id] }
        : slice,
    ),
    lastCommit: status === "committed" ? head : state.lastCommit,
    lastAction: `工单 ${order.id} 转为 ${status}`,
  };
}

/**
 * 把当前 HEAD 纳入记录. 当前工单正在提交时, 视为提交已完成.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} head 当前 HEAD.
 * @param {string} action 动作描述.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 */
export function adoptCommit(state, head, action) {
  const adopted =
    state.order?.status === "committing"
      ? setOrderStatus(state, "committed", head)
      : { ...state, lastCommit: head };
  return { ...adopted, lastAction: action };
}

/**
 * 记录用户已授权的测试命令, 覆盖此前的授权.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string[]} commands 测试命令, 每条一行.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有当前工单时.
 */
export function authorizeTests(state, commands) {
  if (state.order === null) {
    throw new WorkflowError("当前没有工单, 无法授权测试命令.");
  }
  const cleaned = commands
    .map((command) => command.trim())
    .filter((command) => command !== "");
  return {
    ...state,
    order: { ...state.order, authorizedTests: cleaned },
    lastAction: `工单 ${state.order.id} 授权测试 ${cleaned.length} 条`,
  };
}

/**
 * 统计某个切片连续验收不通过的工单数, 从最近一张往前数.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} sliceId 切片编号.
 * @returns {number} 连续不通过的次数.
 */
export function consecutiveRejections(state, sliceId) {
  const history = (state.orders ?? []).filter(
    (order) => order.slice === sliceId,
  );
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].status !== "rejected") {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * 生成移入历史的工单摘要.
 *
 * @param {Record<string, any>} order 结束的工单.
 * @returns {{id: string, slug: string, kind: string, slice: string | null, status: string}} 摘要.
 */
function summarizeOrder(order) {
  return {
    id: order.id,
    slug: order.slug,
    kind: order.kind,
    slice: order.slice,
    status: order.status,
  };
}
