/**
 * @file 会话级信号: 记录 "本会话用过某个 waypoint 技能", 供插件 hook 门控自迭代提示.
 *
 * 信号写在系统临时目录, 不往用户项目里建任何东西: 只有当用户真的按提示记下一条缺陷
 * 时, 项目里才会出现 .waypoint/ 点目录. 信号按会话 id 隔离, 随临时目录自然清理.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 信号目录: 系统临时目录下的 waypoint 专属子目录.
 * @type {string}
 */
const SIGNAL_DIR = path.join(os.tmpdir(), "waypoint-defect-signal");

/**
 * 会话 id 消毒成安全文件名, 空或非法时回退到一个固定名.
 *
 * @param {string} sessionId 会话 id.
 * @returns {string} 消毒后的文件名 (不含目录).
 */
function signalName(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/gu, "_");
  return `${safe === "" ? "unknown" : safe}.marker`;
}

/**
 * 标记本会话用过会自迭代的 waypoint 技能 (门控用). 失败静默, 不打断用户会话.
 *
 * @param {string} sessionId 会话 id.
 * @returns {void}
 */
export function markSkillUsed(sessionId) {
  try {
    mkdirSync(SIGNAL_DIR, { recursive: true });
    writeFileSync(
      path.join(SIGNAL_DIR, signalName(sessionId)),
      `${new Date().toISOString()}\n`,
      "utf8",
    );
  } catch {
    // 失败放行: 门控信号写不成只是少一次提示, 不该影响用户会话.
  }
}

/**
 * 查询本会话此前是否用过 waypoint 技能.
 *
 * @param {string} sessionId 会话 id.
 * @returns {boolean} 用过返回 true.
 */
export function wasSkillUsed(sessionId) {
  try {
    return existsSync(path.join(SIGNAL_DIR, signalName(sessionId)));
  } catch {
    return false;
  }
}
