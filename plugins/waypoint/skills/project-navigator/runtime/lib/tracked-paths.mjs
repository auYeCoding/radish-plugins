/**
 * @file 状态目录中必须能入库的路径: 运行脚本副本, 状态文件, 执行手册, 术语表,
 * 以及规格中每种记录文件的一个示例位置.
 *
 * 入库的 `.claude/settings.json` 中的 hook 指向 `.navigator/bin/` 下的脚本,
 * 对账依赖入库的状态文件, 所以这些路径被项目的忽略规则漏掉时, init 要停下报告.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  BIN_DIRECTORY,
  EXECUTOR_GUIDE_FILE,
  GLOSSARY_FILE,
  NAVIGATOR_IGNORE_FILE,
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
      `${BIN_DIRECTORY}/${RUNTIME_VERSION_FILE}`,
      ...runtimeFiles,
      ...recordFiles,
    ]),
  ];
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
