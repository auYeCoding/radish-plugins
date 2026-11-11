/**
 * @file 必须入库的路径: 状态文件, 术语表, 规格中每种记录文件的一个示例位置,
 * 以及插件管理的项目配置.
 *
 * 编排记录与插件写的项目配置都要随仓库入库, 换机器或 clone 之后才能接着推进,
 * 所以这些路径被忽略规则漏掉时要报告出来. init 与每次进入共用这里的清单与报告
 * 格式; 提交步骤用这里的范围找出还没入库的技能产物.
 */

import {
  ENGINEERING_RULES_FILE,
  GLOSSARY_FILE,
  NAVIGATOR_DIRECTORY,
  NAVIGATOR_IGNORE_FILE,
  PROJECT_SETTINGS_FILE,
  STATE_FILE,
} from "./paths.mjs";
import { listUncommittedPaths } from "./repo.mjs";

/**
 * 替换记录文件路径模式中 "*" 的示例路径段, 只用于检查忽略规则.
 * @type {string}
 */
const SAMPLE_SEGMENT = "0001-sample";

/**
 * 技能产物的范围: 状态目录与插件管理的项目配置. 草稿由状态目录的忽略规则排除.
 * @type {readonly string[]}
 */
export const COMMITTED_PATHSPECS = Object.freeze([
  NAVIGATOR_DIRECTORY,
  PROJECT_SETTINGS_FILE,
  ENGINEERING_RULES_FILE,
]);

/**
 * 列出尚未入库的技能产物: 状态目录与插件管理的项目配置中相对 HEAD 有改动的
 * 文件, 不含状态文件. 状态文件每条命令都会改写, 只有它改动时不值得单独提交.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string[]} 以正斜杠分隔的项目相对路径.
 */
export function listUncommittedProducts(worktreeRoot) {
  return listUncommittedPaths(worktreeRoot, COMMITTED_PATHSPECS).filter(
    (file) => file !== STATE_FILE,
  );
}

/**
 * 列出必须能入库的项目相对路径, 以正斜杠分隔, 不重复.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 路径列表.
 */
export function requiredTrackedPaths(spec) {
  const recordFiles = Object.values(spec.files).map((fileSpec) =>
    fileSpec.pattern.replaceAll("*", SAMPLE_SEGMENT),
  );
  return [
    ...new Set([
      NAVIGATOR_IGNORE_FILE,
      STATE_FILE,
      GLOSSARY_FILE,
      PROJECT_SETTINGS_FILE,
      ENGINEERING_RULES_FILE,
      ...recordFiles,
    ]),
  ];
}

/**
 * 按忽略规则分组描述被忽略的路径: 每条规则写明影响的路径数与一个例子.
 *
 * @param {readonly import("./repo.mjs").IgnoredPath[]} ignored 被忽略的路径.
 * @returns {string[]} 每条规则一句描述.
 */
export function summarizeIgnoredPaths(ignored) {
  return [...Map.groupBy(ignored, (entry) => entry.rule)].map(
    ([rule, entries]) =>
      `${rule}, 影响 ${entries.length} 个路径, 例如 ${entries[0].path}`,
  );
}
