/**
 * @file 状态文件 `state.json` 的创建, 读取与原子写入.
 *
 * `state.json` 是阶段, 里程, 切片, 工单状态与各类编号的唯一来源. 写入时比较
 * 版本号, 并用 "写临时文件再改名" 的方式替换, 防止并发写入互相覆盖或写出半个文件.
 * 编排会话的登记不在这里: 会话身份属于本机的运行环境, 存在运行期登记目录中,
 * 不随 `git reset` 之类的回退改变.
 */

import { existsSync, readFileSync } from "node:fs";

import { writeJsonAtomically } from "./atomic-file.mjs";
import { navigatorPath } from "./paths.mjs";

/**
 * 状态文件结构的版本号; 结构变化时加一, 并在读取时迁移.
 * 版本 3 把编排会话的登记移出状态文件.
 * @type {number}
 */
export const STATE_SCHEMA_VERSION = 3;

/**
 * 初始化状态: 已写入配置, 等待自检确认 hook 生效.
 * @type {string}
 */
export const INIT_PENDING = "pending";

/**
 * 初始化状态: 自检通过, 防护生效.
 * @type {string}
 */
export const INIT_ACTIVE = "active";

/**
 * 初始化状态: 已卸载 hook, 记录保留.
 * @type {string}
 */
export const INIT_UNINSTALLED = "uninstalled";

/**
 * 结构版本 3 之前写在状态文件中的编排会话登记字段, 读取时移除.
 * @type {readonly string[]}
 */
const LEGACY_SESSION_KEYS = Object.freeze(["session", "formerSessions"]);

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
 * @typedef {object} NavigatorState 状态文件的内容.
 * @property {number} schema 结构版本号.
 * @property {number} revision 写入次数, 用于并发比较.
 * @property {string} skillVersion 写入该状态的技能版本.
 * @property {{status: string, initializedAt: string, verifiedAt?: string}} init 初始化信息.
 * @property {number | null} stage 当前阶段编号, 0 至 6; 尚未开始时为 null.
 * @property {string} step 当前步骤标识.
 * @property {string | null} milestone 当前里程编号.
 * @property {string | null} slice 当前切片编号.
 * @property {object | null} order 当前工单.
 * @property {object[]} milestones 里程列表.
 * @property {object[]} slices 切片列表.
 * @property {object[]} orders 已结束的工单摘要.
 * @property {object[]} risks 风险列表.
 * @property {object[]} decisions 决策列表.
 * @property {object[]} changes 变更列表.
 * @property {import("./code-checks.mjs").CodeChecks | null} codeChecks 登记的代码检查命令; 尚未登记时为 null.
 * @property {string[]} evidenceTools 用户授权验收子代理调用的 MCP 取证工具.
 * @property {string | null} lastCommit 记录中的最近提交.
 * @property {string} [pendingAnomaly] 尚未处理的对账异常类别; 存在时暂停快照与其它命令.
 * @property {string} lastAction 最后一个动作的中文描述.
 * @property {string} updatedAt 最后写入时间.
 * @property {object[]} skipped 被跳过的阶段及原因.
 * @property {Record<string, number>} next 各类编号的下一个值.
 */

/**
 * @typedef {object} LegacySessionFields 结构版本 3 之前写在状态文件中的编排会话登记.
 * @property {{id: string, claimedAt?: string} | undefined} session 当时的编排会话.
 * @property {string[]} formerSessions 当时记下的曾经的编排会话.
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
    init: { status: INIT_PENDING, initializedAt: now },
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
    evidenceTools: [],
    lastCommit: null,
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
 */
export function readState(projectRoot) {
  const raw = readRawState(projectRoot);
  return raw === undefined ? undefined : normalizeState(raw);
}

/**
 * 读取结构版本 3 之前写在状态文件中的编排会话登记, 供迁移到运行期登记目录.
 * 状态文件不存在, 不是合法 JSON, 或已是新结构时返回 undefined.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {LegacySessionFields | undefined} 旧的会话登记.
 */
export function readLegacySessionFields(projectRoot) {
  let raw;
  try {
    raw = readRawState(projectRoot);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
  const session =
    typeof raw?.session?.id === "string" && raw.session.id !== ""
      ? { id: raw.session.id, claimedAt: raw.session.claimedAt }
      : undefined;
  const formerSessions = Array.isArray(raw?.formerSessions)
    ? raw.formerSessions.filter((id) => typeof id === "string" && id !== "")
    : [];
  return session === undefined && formerSessions.length === 0
    ? undefined
    : { session, formerSessions };
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
  const current = readState(projectRoot);
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
 * 读取状态文件的原始内容.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {Record<string, any> | undefined} 原始内容; 文件不存在时为 undefined.
 * @throws {SyntaxError} 文件不是合法 JSON 时.
 */
function readRawState(projectRoot) {
  const file = navigatorPath(projectRoot, "state");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/**
 * 为旧版本写入的状态补齐后来新增的字段, 去掉已移出状态文件的会话登记,
 * 并标为当前结构版本, 不修改传入对象.
 *
 * @param {Record<string, any>} raw 读取到的状态.
 * @returns {NavigatorState} 字段齐全的状态.
 */
function normalizeState(raw) {
  const rest = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !LEGACY_SESSION_KEYS.includes(key)),
  );
  return {
    ...rest,
    schema: STATE_SCHEMA_VERSION,
    milestones: raw.milestones ?? [],
    slices: raw.slices ?? [],
    orders: raw.orders ?? [],
    risks: raw.risks ?? [],
    decisions: raw.decisions ?? [],
    changes: raw.changes ?? [],
    codeChecks: raw.codeChecks ?? null,
    evidenceTools: raw.evidenceTools ?? [],
    skipped: raw.skipped ?? [],
  };
}
