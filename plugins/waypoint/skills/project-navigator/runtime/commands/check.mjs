/**
 * @file check 命令: 体检的脚本层. 检查编排文档的结构与写作规则, 分配体检编号.
 *
 * 用法:
 * - check: 检查计划目录中编排会话写的文档, 全部工单与验收记录, 以及最近一份回执
 * - check <文件...>: 只检查指定文件
 *
 * 语义层 (自造简称, 未定义术语, 比喻等) 由编排会话派只读子代理完成, 不在脚本中.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { checkFile, findFileSpec } from "../lib/file-checks.mjs";
import { formatNumber } from "../lib/numbering.mjs";
import {
  GENERATED_FILES,
  navigatorPath,
  orderFilePath,
  projectRelativePath,
  relativePathsEqual,
} from "../lib/paths.mjs";
import { renderTable } from "../lib/table.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { addCheckup } from "../lib/workflow-records.mjs";
import { checkWriting } from "../lib/writing-checks.mjs";
import { openProject, saveState } from "./support.mjs";

/**
 * 工单文件夹中由编排会话编写, 需要检查的文件种类.
 * @type {readonly ("order" | "review")[]}
 */
const ORCHESTRATOR_ORDER_FILES = Object.freeze(["order", "review"]);

/**
 * @typedef {import("../lib/writing-checks.mjs").WritingFinding & {file: string}} FileFinding 带文件路径的问题.
 */

/**
 * 执行 check 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 要检查的文件; 为空时检查默认范围.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 指定的文件不存在时.
 */
export function runCheck({ positionals, cwd, now }) {
  const context = openProject(cwd);
  const files =
    positionals.length > 0
      ? resolveTargets(context.projectRoot, positionals)
      : defaultTargets(context.projectRoot);
  const findings = files.flatMap((file) =>
    checkOneFile(context.projectRoot, file, context.spec),
  );
  const { id, state } = addCheckup(context.state);
  saveState(context, state, now);
  return reportLines({ id, files, findings, spec: context.spec });
}

/**
 * 解析命令行指定的文件, 转换为项目相对路径.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string[]} targets 命令行给出的路径.
 * @returns {string[]} 项目相对路径.
 * @throws {WorkflowError} 文件在项目之外或不存在时.
 */
function resolveTargets(projectRoot, targets) {
  return targets.map((target) => {
    const relative = projectRelativePath(projectRoot, target);
    if (
      relative === undefined ||
      !existsSync(path.join(projectRoot, relative))
    ) {
      throw new WorkflowError(`文件 ${target} 不在项目中或不存在.`);
    }
    return relative;
  });
}

/**
 * 列出默认检查范围: 计划目录中除生成文件外的文档, 各工单的工单与验收记录,
 * 以及编号最大的一份回执.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {string[]} 项目相对路径.
 */
function defaultTargets(projectRoot) {
  const planFiles = listFiles(navigatorPath(projectRoot, "plan"))
    .filter((name) => name.endsWith(".md"))
    .map((name) =>
      projectRelativePath(
        projectRoot,
        path.join(navigatorPath(projectRoot, "plan"), name),
      ),
    )
    .filter(
      (relative) =>
        relative !== undefined &&
        !GENERATED_FILES.some((generated) =>
          relativePathsEqual(generated, relative),
        ),
    );
  const isPresent = (relative) => existsSync(path.join(projectRoot, relative));
  const folders = listFiles(navigatorPath(projectRoot, "orders")).sort();
  const orderFiles = folders.flatMap((folder) =>
    ORCHESTRATOR_ORDER_FILES.map((kind) => orderFilePath(folder, kind)).filter(
      isPresent,
    ),
  );
  const latestReceipt = [...folders]
    .reverse()
    .map((folder) => orderFilePath(folder, "receipt"))
    .find(isPresent);
  return [
    ...planFiles,
    ...orderFiles,
    ...(latestReceipt === undefined ? [] : [latestReceipt]),
  ];
}

/**
 * 列出目录中的条目名; 目录不存在时返回空列表.
 *
 * @param {string} directory 目录.
 * @returns {string[]} 条目名.
 */
function listFiles(directory) {
  return existsSync(directory) ? readdirSync(directory) : [];
}

/**
 * 检查一个文件的结构与写作规则.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} relative 项目相对路径.
 * @param {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {FileFinding[]} 问题.
 */
function checkOneFile(projectRoot, relative, spec) {
  const text = readFileSync(path.join(projectRoot, relative), "utf8");
  const fileSpec = findFileSpec(spec, relative);
  const structure =
    fileSpec === undefined
      ? []
      : checkFile({ text, fileSpec, spec }).map((message) => ({
          label: spec.writing.structure.label,
          severity: spec.writing.structure.severity,
          line: 1,
          message,
        }));
  const writing = checkWriting({
    text,
    spec,
    maxLines:
      fileSpec?.entryPattern === undefined
        ? spec.writing.length.maxFileLines
        : undefined,
  });
  return [...structure, ...writing].map((finding) => ({
    ...finding,
    file: relative,
  }));
}

/**
 * 生成体检结果: 概况, 问题清单 (只列问题级别) 与分类统计.
 *
 * @param {object} options 结果参数.
 * @param {string} options.id 体检编号.
 * @param {string[]} options.files 检查的文件.
 * @param {FileFinding[]} options.findings 全部问题.
 * @param {import("../lib/spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 输出各行.
 */
function reportLines({ id, files, findings, spec }) {
  const problems = findings.filter((finding) => finding.severity === "problem");
  const hints = findings.filter((finding) => finding.severity === "hint");
  const labels = Object.values(spec.writing).map((rule) => rule.label);
  const statistics = labels
    .map((label) => [
      label,
      formatNumber(problems.filter((item) => item.label === label).length),
      formatNumber(hints.filter((item) => item.label === label).length),
    ])
    .filter(([, problemCount, hintCount]) =>
      [problemCount, hintCount].some((count) => Number(count) > 0),
    );
  return [
    `- 体检编号: ${id}`,
    `- 文件数量: ${formatNumber(files.length)}`,
    `- 问题数量: ${formatNumber(problems.length)}`,
    `- 提示数量: ${formatNumber(hints.length)}`,
    "",
    "问题清单:",
    "",
    ...(problems.length === 0
      ? ["无"]
      : renderTable(
          ["文件", "位置", "类别", "说明"],
          problems.map((item) => [
            item.file,
            `第 ${item.line} 行`,
            item.label,
            item.message,
          ]),
        )),
    "",
    "分类统计:",
    "",
    ...(statistics.length === 0
      ? ["无"]
      : renderTable(["类别", "问题", "提示"], statistics)),
  ];
}
