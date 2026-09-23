/**
 * @file 运行期登记信息的读写, 位于 Git 公共目录下的 `navigator/`.
 *
 * 这里存放不入库, 也不应随回退丢失的信息: 执行会话登记, 自检请求与心跳.
 * Git 目录不受 `reset`, `checkout`, `clean` 影响.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { PROBE_HEARTBEAT_FILE, registryDirectory } from "./paths.mjs";

/**
 * 执行会话登记文件所在的子目录名.
 * @type {string}
 */
const SESSIONS_DIRECTORY = "sessions";

/**
 * 自检请求文件名: init 写入, 标明正在等待探测写入.
 * @type {string}
 */
const PROBE_REQUEST_FILE = "probe-request.json";

/**
 * 会话编号中允许出现的字符, 防止拼出目录之外的路径.
 * @type {RegExp}
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

/**
 * @typedef {object} ExecutorRecord 执行会话的登记信息.
 * @property {string} sessionId 会话编号.
 * @property {string} order 绑定的工单编号.
 * @property {string} folder 绑定的工单文件夹名.
 * @property {string} registeredAt 登记时间.
 * @property {boolean} isAligned 用户是否已在开工对齐中选 "继续执行".
 * @property {number} [alignedRound] 完成对齐时工单的发布轮次.
 * @property {boolean} isAwaitingAlignment 执行会话是否已输出开工对齐, 正在等用户选择.
 */

/**
 * 读取某个会话的执行登记.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} sessionId 会话编号.
 * @returns {ExecutorRecord | undefined} 登记信息; 未登记时为 undefined.
 */
export function readExecutorRecord(worktreeRoot, sessionId) {
  const file = executorRecordPath(worktreeRoot, sessionId);
  if (file === undefined || !existsSync(file)) {
    return undefined;
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * 写入某个会话的执行登记.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {ExecutorRecord} record 登记信息.
 * @returns {void}
 * @throws {Error} 会话编号含非法字符时.
 */
export function writeExecutorRecord(worktreeRoot, record) {
  const file = executorRecordPath(worktreeRoot, record.sessionId);
  if (file === undefined) {
    throw new Error(`registry: 会话编号含非法字符: ${record.sessionId}`);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * 写入自检请求, 并清除上一次的心跳.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {void}
 */
export function writeProbeRequest(worktreeRoot, now) {
  const directory = registryDirectory(worktreeRoot);
  mkdirSync(directory, { recursive: true });
  rmSync(path.join(directory, PROBE_HEARTBEAT_FILE), { force: true });
  writeFileSync(
    path.join(directory, PROBE_REQUEST_FILE),
    `${JSON.stringify({ requestedAt: now }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * 守卫拦下探测写入时记录心跳.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} sessionId 发起探测写入的会话.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {void}
 */
export function writeProbeHeartbeat(worktreeRoot, sessionId, now) {
  const directory = registryDirectory(worktreeRoot);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, PROBE_HEARTBEAT_FILE),
    `${JSON.stringify({ sessionId, deniedAt: now }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * 读取自检请求与心跳.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {{request?: {requestedAt: string}, heartbeat?: {sessionId: string, deniedAt: string}}} 请求与心跳, 不存在的项省略.
 */
export function readProbeState(worktreeRoot) {
  const directory = registryDirectory(worktreeRoot);
  return {
    request: readJsonIfExists(path.join(directory, PROBE_REQUEST_FILE)),
    heartbeat: readJsonIfExists(path.join(directory, PROBE_HEARTBEAT_FILE)),
  };
}

/**
 * 返回执行登记文件路径.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} sessionId 会话编号.
 * @returns {string | undefined} 文件路径; 编号含非法字符时为 undefined.
 */
function executorRecordPath(worktreeRoot, sessionId) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return undefined;
  }
  return path.join(
    registryDirectory(worktreeRoot),
    SESSIONS_DIRECTORY,
    `${sessionId}.json`,
  );
}

/**
 * 读取 JSON 文件, 不存在时返回 undefined.
 *
 * @param {string} file 文件路径.
 * @returns {any} 文件内容; 不存在时为 undefined.
 */
function readJsonIfExists(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}
