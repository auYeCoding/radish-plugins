/**
 * @file 必须入库的路径: 状态目录中的运行脚本副本, 状态文件, 执行手册, 术语表,
 * 规格中每种记录文件的一个示例位置, 以及插件管理的项目配置.
 *
 * 入库的 `.claude/settings.json` 中的 hook 指向 `.navigator/bin/` 下的脚本,
 * 对账依赖入库的状态文件, 所以这些路径被忽略规则漏掉, 或提交后仍未入库时,
 * 都要报告出来. init, 每次进入与提交收尾共用这里的清单与报告格式.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  BIN_DIRECTORY,
  ENGINEERING_RULES_FILE,
  EXECUTOR_GUIDE_FILE,
  GLOSSARY_FILE,
  NAVIGATOR_DIRECTORY,
  NAVIGATOR_IGNORE_FILE,
  PROJECT_SETTINGS_FILE,
  RUNTIME_COPY_DIRECTORIES,
  RUNTIME_VERSION_FILE,
  SKILL_ROOT,
  STATE_FILE,
} from "./paths.mjs";

/**
 * 替换记录文件路径模式中 "*" 的示例路径段, 只用于检查忽略规则.
 * @type {string}
 */
const SAMPLE_SEGMENT = "0001-sample";

/**
 * 提交收尾时必须已经全部入库的范围: 状态目录与插件管理的项目配置.
 * 草稿由状态目录的忽略规则排除, 不在检查之列.
 * @type {readonly string[]}
 */
export const COMMITTED_PATHSPECS = Object.freeze([
  NAVIGATOR_DIRECTORY,
  PROJECT_SETTINGS_FILE,
  ENGINEERING_RULES_FILE,
]);

/**
 * 列出必须能入库的项目相对路径, 以正斜杠分隔, 不重复.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 路径列表.
 */
export function requiredTrackedPaths(spec) {
  const runtimeFiles = RUNTIME_COPY_DIRECTORIES.flatMap((directory) =>
    listFiles(path.join(SKILL_ROOT, directory)).map(
      (relative) => `${BIN_DIRECTORY}/${directory}/${relative}`,
    ),
  );
  const recordFiles = Object.values(spec.files).map((fileSpec) =>
    fileSpec.pattern.replaceAll("*", SAMPLE_SEGMENT),
  );
  return [
    ...new Set([
      NAVIGATOR_IGNORE_FILE,
      STATE_FILE,
      EXECUTOR_GUIDE_FILE,
      GLOSSARY_FILE,
      PROJECT_SETTINGS_FILE,
      ENGINEERING_RULES_FILE,
      `${BIN_DIRECTORY}/${RUNTIME_VERSION_FILE}`,
      ...runtimeFiles,
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

/**
 * 递归列出目录中的文件, 返回以正斜杠分隔的相对路径.
 *
 * @param {string} directory 目录的绝对路径.
 * @returns {string[]} 相对于该目录的文件路径.
 */
function listFiles(directory) {
  return readdirSync(directory, { recursive: true })
    .map(String)
    .filter((relative) => statSync(path.join(directory, relative)).isFile())
    .map((relative) => relative.split(path.sep).join("/"));
}
