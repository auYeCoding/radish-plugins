/**
 * @file 读取当前工单回执中的执行状态, 供下一动作判断受阻还是完成.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { findSection, readKeyValues } from "./layout.mjs";
import { orderFilePath } from "./paths.mjs";

/**
 * 回执中放执行状态的节, 与规格 files.receipt 中的节标题一致.
 * @type {string}
 */
const OVERVIEW_SECTION = "回执概况";

/**
 * 回执概况中写执行状态的键.
 * @type {string}
 */
const STATUS_KEY = "执行状态";

/**
 * 读取当前工单回执中的执行状态.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{folder: string}} order 当前工单.
 * @returns {string | undefined} 执行状态; 回执不存在时为 undefined, 回执中没有这一项时为空字符串.
 */
export function readReceiptStatus(projectRoot, order) {
  const file = path.join(projectRoot, orderFilePath(order.folder, "receipt"));
  if (!existsSync(file)) {
    return undefined;
  }
  const section = findSection(readFileSync(file, "utf8"), OVERVIEW_SECTION);
  return section === undefined
    ? ""
    : (readKeyValues(section)[STATUS_KEY] ?? "");
}
