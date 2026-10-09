/**
 * @file waypoint 自迭代的路径工具: 定位缺陷点目录 .waypoint/. 不依赖其它插件,
 * 以便 waypoint 独立安装时自迭代也可用.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 缺陷点目录名: 目标项目里的点目录, 只在真的记了缺陷时才出现.
 * @type {string}
 */
export const DEFECT_DIR_NAME = ".waypoint";

/**
 * 从起始目录向上逐级查找最近的缺陷点目录.
 *
 * @param {string} startDir 起始目录 (通常是会话工作目录).
 * @returns {string | undefined} 点目录的绝对路径; 没找到时为 undefined.
 */
export function findDefectDir(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, DEFECT_DIR_NAME);
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
