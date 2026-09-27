/**
 * @file 待并入快照的写入: 位于运行期登记目录的 `pending-writes/`.
 *
 * 同一次工具调用的 PostToolUse hook 并行运行. 用户装有格式化 hook 时, 插件在
 * PostToolUse 中立即拍快照, 拍到的是格式化之前的内容, 对账随后把格式化后的
 * 文件当成手工改动. 所以 PostToolUse 只为写入的文件留下标记, 等这次工具调用的
 * hook 全部结束之后 (插件命令对账之前, 以及 Stop, UserPromptSubmit, SessionStart
 * 事件) 再把标记过的文件增量并入快照.
 *
 * 每次写入一个标记文件, 文件名由路径的摘要得出, 多个会话同时写入时不会互相覆盖.
 * 标记带一次性令牌, 并入之后只删除令牌未变的标记: 并入期间同一文件又被写入时,
 * 新标记保留到下一次并入.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { writeJsonAtomically } from "./atomic-file.mjs";
import { PENDING_WRITES_DIRECTORY, registryDirectory } from "./paths.mjs";
import { recordSnapshotChanges } from "./snapshots.mjs";

/**
 * 标记文件的扩展名.
 * @type {string}
 */
const MARKER_EXTENSION = ".json";

/**
 * @typedef {object} PendingWrite 一个待并入快照的写入标记.
 * @property {string} path 写入的文件, 以正斜杠分隔的项目相对路径.
 * @property {string} token 本次标记的一次性令牌.
 */

/**
 * 为一次写入留下标记. 同一文件再次写入时覆盖原标记并换新令牌.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} relativePath 写入的文件, 以正斜杠分隔的项目相对路径.
 * @returns {void}
 */
export function markPendingWrite(worktreeRoot, relativePath) {
  writeJsonAtomically(markerPath(worktreeRoot, relativePath), {
    path: relativePath,
    token: randomUUID(),
  });
}

/**
 * 把标记过的文件增量并入快照, 然后删除令牌未变的标记.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {{now: string, head: string | undefined}} options 拍摄时间与当前 HEAD.
 * @returns {string[]} 本次并入的文件.
 */
export function flushPendingWrites(worktreeRoot, { now, head }) {
  const markers = readMarkers(worktreeRoot);
  if (markers.length === 0) {
    return [];
  }
  const paths = markers.map((marker) => marker.path);
  recordSnapshotChanges(worktreeRoot, { paths, now, head });
  for (const marker of markers) {
    removeMarkerIfUnchanged(worktreeRoot, marker);
  }
  return paths;
}

/**
 * 删除全部标记. 完整快照已按状态目录的当前内容拍摄时调用.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {void}
 */
export function clearPendingWrites(worktreeRoot) {
  rmSync(markerDirectory(worktreeRoot), { recursive: true, force: true });
}

/**
 * 读取全部标记; 读到写了一半或格式不对的标记时跳过.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {PendingWrite[]} 标记列表.
 */
function readMarkers(worktreeRoot) {
  const directory = markerDirectory(worktreeRoot);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(MARKER_EXTENSION))
    .flatMap((name) => {
      const marker = readMarker(path.join(directory, name));
      return marker === undefined ? [] : [marker];
    });
}

/**
 * 读取一个标记文件.
 *
 * @param {string} file 标记文件路径.
 * @returns {PendingWrite | undefined} 标记; 文件不存在或内容不合法时为 undefined.
 */
function readMarker(file) {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return typeof raw.path === "string" && typeof raw.token === "string"
      ? { path: raw.path, token: raw.token }
      : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 标记的令牌仍与并入时读到的一致时删除该标记.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {PendingWrite} marker 并入时读到的标记.
 * @returns {void}
 */
function removeMarkerIfUnchanged(worktreeRoot, marker) {
  const file = markerPath(worktreeRoot, marker.path);
  if (readMarker(file)?.token === marker.token) {
    rmSync(file, { force: true });
  }
}

/**
 * 返回标记目录的绝对路径.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string} 目录路径.
 */
function markerDirectory(worktreeRoot) {
  return path.join(registryDirectory(worktreeRoot), PENDING_WRITES_DIRECTORY);
}

/**
 * 返回某个文件的标记路径, 文件名为项目相对路径的摘要.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} relativePath 以正斜杠分隔的项目相对路径.
 * @returns {string} 标记文件路径.
 */
function markerPath(worktreeRoot, relativePath) {
  const digest = createHash("sha1").update(relativePath).digest("hex");
  return path.join(
    markerDirectory(worktreeRoot),
    `${digest}${MARKER_EXTENSION}`,
  );
}
