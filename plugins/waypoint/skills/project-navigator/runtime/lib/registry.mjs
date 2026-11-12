/**
 * @file 运行期登记信息的读写, 位于 Git 公共目录下的 `navigator/`.
 *
 * 这里只存工单审阅记录: 不入库, 也不应随回退丢失. Git 目录不受 `reset`,
 * `checkout`, `clean` 影响. hook 会读写这个文件, 所以一律原子写入.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { writeJsonAtomically } from "./atomic-file.mjs";
import { ORDER_APPROVAL_FILE, registryDirectory } from "./paths.mjs";

/**
 * @typedef {object} OrderApprovalRecord 用户对一张工单的审阅.
 * @property {string} order 工单编号.
 * @property {string} digest 审阅时工单文件内容的摘要.
 * @property {"awaiting" | "approved" | "declined"} status 等待用户选择, 用户已选发布, 或用户没有选发布.
 * @property {string} updatedAt 最后更新时间.
 */

/**
 * 读取工单审阅记录.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {OrderApprovalRecord | undefined} 审阅记录; 没有时为 undefined.
 */
export function readOrderApproval(worktreeRoot) {
  const file = orderApprovalPath(worktreeRoot);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/**
 * 写入工单审阅记录.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {OrderApprovalRecord} record 审阅记录.
 * @returns {void}
 */
export function writeOrderApproval(worktreeRoot, record) {
  writeJsonAtomically(orderApprovalPath(worktreeRoot), record);
}

/**
 * 删除工单审阅记录: 已用于发布工单, 或工单文件不存在.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {void}
 */
export function removeOrderApproval(worktreeRoot) {
  rmSync(orderApprovalPath(worktreeRoot), { force: true });
}

/**
 * 返回工单审阅记录的路径.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string} 文件路径.
 */
function orderApprovalPath(worktreeRoot) {
  return path.join(registryDirectory(worktreeRoot), ORDER_APPROVAL_FILE);
}
