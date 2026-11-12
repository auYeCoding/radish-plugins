/**
 * @file 工单的类型与状态转换. 所有函数都返回新状态, 不修改传入的状态.
 *
 * 状态流转:
 * drafting (起草) → issued (已发布, 执行子代理工作中) → reviewing (验收中)
 * → accepted (已通过).
 * issued 可转为 blocked (受阻); blocked 处理后重新 issued, 或撤回为 drafting
 * 修改; issued 也可撤回为 drafting; 验收不通过为 rejected; 任何未结束的工单
 * 都可以 voided (作废). accepted, rejected, voided 是结束状态, 结束的工单移入
 * 历史, 当前工单清空. 提交不是工单状态: 验收通过之后由编排会话提交.
 */

import { allocateNumber } from "./numbering.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 工单状态及允许转入的下一状态.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ORDER_TRANSITIONS = Object.freeze({
  drafting: ["issued", "voided"],
  issued: ["reviewing", "blocked", "drafting", "voided"],
  blocked: ["issued", "drafting", "voided"],
  reviewing: ["accepted", "rejected"],
});

/**
 * 结束状态: 工单进入这些状态后移入历史.
 * @type {readonly string[]}
 */
export const TERMINAL_ORDER_STATUSES = Object.freeze([
  "accepted",
  "rejected",
  "voided",
]);

/**
 * 发布状态.
 * @type {string}
 */
export const ISSUED_ORDER_STATUS = "issued";

/**
 * 起草状态: 发布前核对只对这个状态的工单强制要求.
 * @type {string}
 */
export const DRAFTING_ORDER_STATUS = "drafting";

/**
 * 可以请用户审阅的工单状态: 起草中, 以及受阻后修改待重新发布.
 * @type {readonly string[]}
 */
export const REVIEWABLE_ORDER_STATUSES = Object.freeze([
  DRAFTING_ORDER_STATUS,
  "blocked",
]);

/**
 * 实现工单的类型名.
 * @type {string}
 */
export const IMPLEMENTATION_ORDER_KIND = "implementation";

/**
 * 选型工单的类型名.
 * @type {string}
 */
export const SELECTION_ORDER_KIND = "selection";

/**
 * 运行检查工单的类型名. 运行检查工单不修改任何文件.
 * @type {string}
 */
export const RUNCHECK_ORDER_KIND = "runcheck";

/**
 * 分析工单的类型名: 逆向, 调研等只产出文档与证据脚本的任务.
 * @type {string}
 */
export const ANALYSIS_ORDER_KIND = "analysis";

/**
 * 修复工单的类型名.
 * @type {string}
 */
export const FIX_ORDER_KIND = "fix";

/**
 * 工单类型.
 * @type {readonly string[]}
 */
export const ORDER_KINDS = Object.freeze([
  IMPLEMENTATION_ORDER_KIND,
  SELECTION_ORDER_KIND,
  RUNCHECK_ORDER_KIND,
  ANALYSIS_ORDER_KIND,
  FIX_ORDER_KIND,
]);

/**
 * 只产出记录的工单类型: 执行子代理只能写回执与本工单的 artifacts/, 不改业务文件.
 * @type {readonly string[]}
 */
export const RECORD_ONLY_ORDER_KINDS = Object.freeze([
  RUNCHECK_ORDER_KIND,
  ANALYSIS_ORDER_KIND,
]);

/**
 * 判断某种工单是否只产出记录.
 *
 * @param {string} kind 工单类型.
 * @returns {boolean} 只产出记录时返回 true.
 */
export function isRecordOnlyOrderKind(kind) {
  return RECORD_ONLY_ORDER_KINDS.includes(kind);
}

/**
 * 工单短名的格式: 小写字母, 数字与连字符.
 * @type {RegExp}
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * 新建工单, 成为当前工单. 工单严格串行: 已有未结束的工单时不能新建. 没有指定
 * 切片时挂在当前切片上, 这样路线中的工单列表按切片统计.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {object} options 工单参数.
 * @param {string} options.kind 工单类型.
 * @param {string} options.slug 文件夹短名.
 * @param {string | undefined} options.slice 所属切片编号; 省略时为当前切片.
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
    const ids = state.slices.map((entry) => entry.id).join(", ") || "无";
    throw new WorkflowError(
      `切片 ${slice} 不存在. 切片编号是四位数字, 不是进展中的序号: 现有切片 ${ids}, 当前切片 ${state.slice ?? "无"}. 不带 --slice 时默认挂在当前切片.`,
    );
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
      slice: slice ?? state.slice ?? null,
      status: DRAFTING_ORDER_STATUS,
      round: 0,
      baseCommit,
    },
    lastAction: `新建工单 ${id}`,
  };
}

/**
 * 转换当前工单的状态. 每次发布 (含受阻或撤回后重新发布) 时发布轮次加一,
 * 并记下发布时工单文件的摘要与基准提交; 进入结束状态时移入历史.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} status 目标状态.
 * @param {{issuedDigest?: string, baseCommit?: string}} [options] 发布时工单文件内容的摘要, 以及发布时的当前提交; 不给基准提交时保持原值.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有当前工单或转换不合法时.
 */
export function setOrderStatus(
  state,
  status,
  { issuedDigest, baseCommit } = {},
) {
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
  const updated =
    status === ISSUED_ORDER_STATUS
      ? {
          ...order,
          status,
          round: (order.round ?? 0) + 1,
          issuedDigest,
          baseCommit: baseCommit ?? order.baseCommit,
        }
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
    lastAction: `工单 ${order.id} 转为 ${status}`,
  };
}

/**
 * 记下当前工单已做过发布前核对. 核对一次即可: 按核对结果修改工单, 或受阻后
 * 修改工单, 都不要求再核对.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 没有当前工单, 或工单已经发布时.
 */
export function markPrechecked(state) {
  const order = state.order;
  if (order === null) {
    throw new WorkflowError("当前没有工单.");
  }
  if (!REVIEWABLE_ORDER_STATUSES.includes(order.status)) {
    throw new WorkflowError(
      `工单 ${order.id} 处于 ${order.status}, 发布前核对只用于 ${REVIEWABLE_ORDER_STATUSES.join(", ")} 状态的工单.`,
    );
  }
  return {
    ...state,
    order: { ...order, prechecked: true },
    lastAction: `工单 ${order.id} 已做发布前核对`,
  };
}

/**
 * 说明当前工单为什么还不能请用户审阅: 起草中的工单要先做发布前核对.
 *
 * @param {import("./state.mjs").OrderState} order 当前工单.
 * @returns {string | undefined} 原因; 可以审阅时为 undefined.
 */
export function precheckBlocker(order) {
  return order.status === DRAFTING_ORDER_STATUS && order.prechecked !== true
    ? `工单 ${order.id} 还没有做发布前核对: 运行 precheck-brief, 派核对子代理, 按结果改好工单后运行 order precheck.`
    : undefined;
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
