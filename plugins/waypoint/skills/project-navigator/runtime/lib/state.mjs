/**
 * @file 状态文件 `state.json` 的创建, 读取与原子写入.
 *
 * `state.json` 是阶段, 里程, 切片, 工单状态与各类编号的唯一来源. 写入时比较
 * 版本号, 并用 "写临时文件再改名" 的方式替换, 防止并发写入互相覆盖或写出半个文件.
 * 读取时迁移旧结构: 去掉 1.0.0 之前的会话登记, 对账与提交结算字段.
 */

import { existsSync, readFileSync } from "node:fs";

import { writeJsonAtomically } from "./atomic-file.mjs";
import { navigatorPath } from "./paths.mjs";

/**
 * 状态文件结构的版本号; 结构变化时加一, 并在读取时迁移.
 * 版本 5 去掉会话登记, 对账, 阶段提交与取证工具登记, 工单不再有提交中的状态.
 * @type {number}
 */
export const STATE_SCHEMA_VERSION = 5;

/**
 * 初始化状态: 已初始化, 插件的 hook 在本项目中生效.
 * @type {string}
 */
export const INIT_ACTIVE = "active";

/**
 * 初始化状态: 已卸载, 记录保留, 插件的 hook 在本项目中不做任何事.
 * @type {string}
 */
export const INIT_UNINSTALLED = "uninstalled";

/**
 * 旧结构中已经不用的顶层字段, 读取时移除.
 * @type {readonly string[]}
 */
const LEGACY_KEYS = Object.freeze([
  "session",
  "formerSessions",
  "lastCommit",
  "stageCommit",
  "pendingAnomaly",
  "evidenceTools",
]);

/**
 * 旧结构中表示验收通过之后正在或等待提交的工单状态; 读取时视为已通过并结束.
 * @type {readonly string[]}
 */
const LEGACY_ACCEPTED_STATUSES = Object.freeze(["accepted", "committing"]);

/**
 * 读取状态文件时发现版本号与预期不一致时抛出的错误.
 */
export class StateConflictError extends Error {
  /**
   * @param {string} message 错误信息.
   */
  constructor(message) {
    super(message);
    this.name = "StateConflictError";
  }
}

/**
 * @typedef {object} OrderState 当前工单.
 * @property {string} id 工单编号.
 * @property {string} slug 文件夹短名.
 * @property {string} folder 工单文件夹名.
 * @property {string} kind 工单类型.
 * @property {string | null} slice 所属切片编号.
 * @property {string} status 工单状态.
 * @property {number} round 发布轮次.
 * @property {string} baseCommit 基准提交.
 * @property {string} [issuedDigest] 最近一次发布时工单文件内容的摘要.
 * @property {boolean} [prechecked] 是否已做过发布前核对.
 */

/**
 * @typedef {object} NavigatorState 状态文件的内容.
 * @property {number} schema 结构版本号.
 * @property {number} revision 写入次数, 用于并发比较.
 * @property {string} skillVersion 写入该状态的技能版本.
 * @property {{status: string, initializedAt: string, uninstalledAt?: string}} init 初始化信息.
 * @property {number | null} stage 当前阶段编号, 0 至 6; 尚未开始时为 null.
 * @property {string} step 当前步骤标识.
 * @property {string | null} milestone 当前里程编号.
 * @property {string | null} slice 当前切片编号.
 * @property {OrderState | null} order 当前工单.
 * @property {object[]} milestones 里程列表.
 * @property {object[]} slices 切片列表.
 * @property {object[]} orders 已结束的工单摘要.
 * @property {object[]} risks 风险列表.
 * @property {object[]} decisions 决策列表.
 * @property {object[]} changes 变更列表.
 * @property {import("./code-checks.mjs").CodeChecks | null} codeChecks 登记的代码检查命令; 尚未登记时为 null.
 * @property {Record<string, string>} models 子代理模型分配中与默认不同的部分, 键见 subagent-models.mjs.
 * @property {string} lastAction 最后一个动作的中文描述.
 * @property {string} updatedAt 最后写入时间.
 * @property {object[]} skipped 被跳过的阶段及原因.
 * @property {Record<string, number>} next 各类编号的下一个值.
 */

/**
 * 创建初始化完成后的第一份状态.
 *
 * @param {object} options 创建参数.
 * @param {string} options.skillVersion 技能版本.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {NavigatorState} 初始状态.
 */
export function createInitialState({ skillVersion, now }) {
  return {
    schema: STATE_SCHEMA_VERSION,
    revision: 0,
    skillVersion,
    init: { status: INIT_ACTIVE, initializedAt: now },
    stage: null,
    step: "entry",
    milestone: null,
    slice: null,
    order: null,
    milestones: [],
    slices: [],
    orders: [],
    risks: [],
    decisions: [],
    changes: [],
    codeChecks: null,
    models: {},
    lastAction: "初始化",
    updatedAt: now,
    skipped: [],
    next: {
      milestone: 1,
      slice: 1,
      order: 1,
      decision: 1,
      change: 1,
      risk: 1,
      checkup: 1,
    },
  };
}

/**
 * 读取状态文件.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {NavigatorState | undefined} 状态; 文件不存在时为 undefined.
 * @throws {SyntaxError} 文件不是合法 JSON 时.
 */
export function readState(projectRoot) {
  const file = navigatorPath(projectRoot, "state");
  return existsSync(file)
    ? normalizeState(JSON.parse(readFileSync(file, "utf8")))
    : undefined;
}

/**
 * 读取状态文件; 文件不存在或不是合法 JSON 时返回 undefined.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {NavigatorState | undefined} 状态.
 * @throws {Error} 读取文件本身失败时.
 */
export function readStateIfValid(projectRoot) {
  try {
    return readState(projectRoot);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 原子写入状态文件. 写入前核对磁盘上的版本号, 写入时版本号加一.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {NavigatorState} state 要写入的状态, 其 revision 必须等于磁盘上的当前值.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {NavigatorState} 实际写入的状态.
 * @throws {StateConflictError} 当磁盘上的版本号与传入的不一致时.
 */
export function writeState(projectRoot, state, now) {
  const current = readStateIfValid(projectRoot);
  if (current !== undefined && current.revision !== state.revision) {
    throw new StateConflictError(
      `state: 版本冲突, 磁盘为 ${current.revision}, 写入基于 ${state.revision}`,
    );
  }
  const next = normalizeState({
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
  });
  writeJsonAtomically(navigatorPath(projectRoot, "state"), next);
  return next;
}

/**
 * 为旧版本写入的状态补齐字段, 去掉不再使用的字段, 并标为当前结构版本,
 * 不修改传入对象. 验收通过后等待或正在提交的旧工单视为已通过并结束.
 *
 * @param {Record<string, any>} raw 读取到的状态.
 * @returns {NavigatorState} 字段齐全的状态.
 */
function normalizeState(raw) {
  const rest = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !LEGACY_KEYS.includes(key)),
  );
  const order = raw.order ?? null;
  const isLegacyAccepted =
    order !== null && LEGACY_ACCEPTED_STATUSES.includes(order.status);
  const orders = raw.orders ?? [];
  const slices = raw.slices ?? [];
  return {
    ...rest,
    schema: STATE_SCHEMA_VERSION,
    init: { ...raw.init, status: normalizeInitStatus(raw.init?.status) },
    order: isLegacyAccepted ? null : stripLegacyOrderFields(order),
    milestones: raw.milestones ?? [],
    slices: isLegacyAccepted
      ? slices.map((slice) =>
          slice.id === order.slice
            ? { ...slice, orders: [...(slice.orders ?? []), order.id] }
            : slice,
        )
      : slices,
    orders: isLegacyAccepted
      ? [...orders, summarizeLegacyOrder(order)]
      : orders,
    risks: raw.risks ?? [],
    decisions: raw.decisions ?? [],
    changes: raw.changes ?? [],
    codeChecks: raw.codeChecks ?? null,
    models: raw.models ?? {},
    skipped: raw.skipped ?? [],
  };
}

/**
 * 旧结构中 "已写入配置, 等待自检" 的状态现在视为已初始化.
 *
 * @param {string | undefined} status 读取到的初始化状态.
 * @returns {string} 当前结构中的初始化状态.
 */
function normalizeInitStatus(status) {
  return status === INIT_UNINSTALLED ? INIT_UNINSTALLED : INIT_ACTIVE;
}

/**
 * 去掉旧工单中不再使用的字段.
 *
 * @param {Record<string, any> | null} order 当前工单.
 * @returns {OrderState | null} 去掉字段后的工单.
 */
function stripLegacyOrderFields(order) {
  if (order === null) {
    return null;
  }
  const { authorizedTests: _authorizedTests, ...rest } = order;
  return /** @type {OrderState} */ (rest);
}

/**
 * 生成验收通过后等待或正在提交的旧工单的历史摘要.
 *
 * @param {Record<string, any>} order 旧工单.
 * @returns {{id: string, slug: string, kind: string, slice: string | null, status: string}} 摘要.
 */
function summarizeLegacyOrder(order) {
  return {
    id: order.id,
    slug: order.slug,
    kind: order.kind,
    slice: order.slice,
    status: "accepted",
  };
}
