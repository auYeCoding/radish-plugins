/**
 * @file tracepoint 的路径工具: 定位案卷目录, 计算相对路径. 不依赖其它插件,
 * 以便与它们各自独立地共存.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 案卷目录名: 目标目录内的点目录.
 * @type {string}
 */
export const CASE_DIR_NAME = ".tracepoint";

/**
 * 从起始目录向上逐级查找最近的案卷目录.
 *
 * @param {string} startDir 起始目录 (通常是会话工作目录).
 * @returns {string | undefined} 案卷目录的绝对路径; 没找到时为 undefined.
 */
export function findCaseDir(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, CASE_DIR_NAME);
    if (isDirectory(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * 判断一个路径是否为存在的目录.
 *
 * @param {string} target 待判断的路径.
 * @returns {boolean} 是存在的目录时返回 true.
 */
function isDirectory(target) {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}
