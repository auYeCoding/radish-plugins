/**
 * @file 查询运行脚本的版本号.
 *
 * 插件中的运行脚本以插件清单 `plugin.json` 中的版本为准; 复制进项目的副本以
 * init 写入的版本文件为准. 两者比较即可判断项目中的副本是否需要升级.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { RUNTIME_VERSION_FILE, SKILL_ROOT } from "./paths.mjs";

/**
 * 从技能目录向上查找插件清单时最多经过的层数 (技能目录, skills, 插件根目录).
 * @type {number}
 */
const MANIFEST_SEARCH_DEPTH = 3;

/**
 * 插件清单相对于插件根目录的路径.
 * @type {string}
 */
const PLUGIN_MANIFEST = path.join(".claude-plugin", "plugin.json");

/**
 * 查不到版本号时使用的版本.
 * @type {string}
 */
const UNKNOWN_VERSION = "0.0.0";

/**
 * 参与比较的版本号段数: 主版本, 次版本, 修订号.
 * @type {number}
 */
const VERSION_PART_COUNT = 3;

/**
 * 返回当前运行脚本的版本号.
 *
 * @param {string} [skillRoot] 技能目录; 默认为当前脚本所在的技能目录.
 * @returns {string} 版本号; 查不到时为 UNKNOWN_VERSION.
 */
export function runtimeVersion(skillRoot = SKILL_ROOT) {
  const versionFile = path.join(skillRoot, RUNTIME_VERSION_FILE);
  if (existsSync(versionFile)) {
    return JSON.parse(readFileSync(versionFile, "utf8")).version;
  }
  let directory = skillRoot;
  for (let depth = 0; depth < MANIFEST_SEARCH_DEPTH; depth += 1) {
    const manifest = path.join(directory, PLUGIN_MANIFEST);
    if (existsSync(manifest)) {
      return JSON.parse(readFileSync(manifest, "utf8")).version;
    }
    directory = path.dirname(directory);
  }
  return UNKNOWN_VERSION;
}

/**
 * 比较两个语义化版本号的主, 次, 修订号.
 *
 * @param {string} first 第一个版本号.
 * @param {string} second 第二个版本号.
 * @returns {number} first 较旧时为负数, 相同时为 0, 较新时为正数.
 */
export function compareVersions(first, second) {
  const firstParts = first.split(".").map(Number);
  const secondParts = second.split(".").map(Number);
  for (let index = 0; index < VERSION_PART_COUNT; index += 1) {
    const difference = (firstParts[index] ?? 0) - (secondParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
