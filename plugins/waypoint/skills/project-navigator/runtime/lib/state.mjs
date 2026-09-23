/**
 * @file 状态文件 `state.json` 的创建, 读取与原子写入.
 *
 * `state.json` 是阶段, 里程, 切片, 工单状态与各类编号的唯一来源. 写入时比较
 * 版本号, 并用 "写临时文件再改名" 的方式替换, 防止并发写入互相覆盖或写出半个文件.
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { navigatorPath } from "./paths.mjs";

/**
 * 状态文件结构的版本号; 结构变化时加一, 并在读取时迁移.
 * @type {number}
 */
export const STATE_SCHEMA_VERSION = 1;

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
 * 改名时遇到文件被占用 (Windows 上常见) 后的最大重试次数.
 * @type {number}
 */
const RENAME_RETRY_LIMIT = 5;

/**
 * 两次改名重试之间的等待毫秒数.
 * @type {number}
 */
const RENAME_RETRY_DELAY_MS = 50;

/**
 * Windows 上文件被其它进程占用时改名返回的错误码.
 * @type {readonly string[]}
 */
const RETRYABLE_RENAME_CODES = Object.freeze(["EPERM", "EBUSY", "EACCES"]);

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
 * @property {{id?: string, claimedAt?: string}} session 当前编排会话.
 * @property {string[]} formerSessions 曾经的编排会话, 这些会话不会被登记为执行会话.
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
 * @property {string | null} lastCommit 记录中的最近提交.
 * @property {string} [pendingAnomaly] 尚未处理的对账异常类别; 存在时暂停快照与其它命令.
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
 * @param {string | undefined} options.sessionId 发起初始化的编排会话.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {NavigatorState} 初始状态.
 */
export function createInitialState({ skillVersion, sessionId, now }) {
  return {
    schema: STATE_SCHEMA_VERSION,
    revision: 0,
    skillVersion,
    init: { status: INIT_PENDING, initializedAt: now },
    session: sessionId === undefined ? {} : { id: sessionId, claimedAt: now },
    formerSessions: [],
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
  const file = navigatorPath(projectRoot, "state");
  if (!existsSync(file)) {
    return undefined;
  }
  return normalizeState(JSON.parse(readFileSync(file, "utf8")));
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
  const next = { ...state, revision: state.revision + 1, updatedAt: now };
  const file = navigatorPath(projectRoot, "state");
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    renameWithRetry(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error("state: 无法替换状态文件", { cause: error });
  }
  return next;
}

/**
 * 为旧版本写入的状态补齐后来新增的字段, 不修改传入对象.
 *
 * @param {Record<string, any>} raw 读取到的状态.
 * @returns {NavigatorState} 字段齐全的状态.
 */
function normalizeState(raw) {
  return {
    ...raw,
    formerSessions: raw.formerSessions ?? [],
    milestones: raw.milestones ?? [],
    slices: raw.slices ?? [],
    orders: raw.orders ?? [],
    risks: raw.risks ?? [],
    decisions: raw.decisions ?? [],
    changes: raw.changes ?? [],
    skipped: raw.skipped ?? [],
  };
}

/**
 * 改名替换文件, 遇到占用类错误时短暂等待后重试.
 *
 * @param {string} source 源文件.
 * @param {string} target 目标文件.
 * @returns {void}
 * @throws {Error} 重试用尽或遇到其它错误时.
 */
function renameWithRetry(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      const isRetryable =
        error instanceof Error &&
        RETRYABLE_RENAME_CODES.includes(/** @type {any} */ (error).code);
      if (!isRetryable || attempt >= RENAME_RETRY_LIMIT) {
        throw error;
      }
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        RENAME_RETRY_DELAY_MS,
      );
    }
  }
}
