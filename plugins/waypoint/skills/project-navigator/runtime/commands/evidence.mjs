/**
 * @file evidence 命令: 从原仓库取回选型回执中引用的源码行, 供验收子代理与执行会话核对.
 *
 * 用法:
 * - evidence: 核对当前选型工单回执 "能力核实" 表中的全部证据
 * - evidence check <仓库> <版本> <路径> <行号>: 核对一条证据, 执行会话写回执前自查
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { EVIDENCE_COMMAND_NAME } from "../lib/command-access.mjs";
import { evidenceCacheDirectory, orderFilePath } from "../lib/paths.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import {
  EVIDENCE_CHECK_ACTION,
  formatEvidence,
  readEvidenceRows,
  verifyEvidenceRows,
} from "../lib/source-evidence.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { SELECTION_ORDER_KIND } from "../lib/workflow-orders.mjs";
import { openProject } from "./support.mjs";

/**
 * 单条自查时 check 之后的参数个数: 仓库, 版本, 路径, 行号.
 * @type {number}
 */
const CHECK_ARGUMENT_COUNT = 4;

/**
 * 单条自查时, 证据中 "能力" 与 "说明" 两列显示的文字.
 * @type {Readonly<{capability: string, note: string}>}
 */
const SELF_CHECK_LABELS = Object.freeze({
  capability: "单条自查",
  note: "无",
});

/**
 * 执行 evidence 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {string} options.cwd 会话工作目录.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法, 没有选型工单或回执中没有证据表时.
 */
export function runEvidence({ positionals, cwd }) {
  const [action, ...rest] = positionals;
  if (action === undefined) {
    return verifyReceipt(cwd);
  }
  if (
    action === EVIDENCE_CHECK_ACTION &&
    rest.length === CHECK_ARGUMENT_COUNT
  ) {
    return verifySingle(cwd, rest);
  }
  throw new WorkflowError(
    `${EVIDENCE_COMMAND_NAME} 的用法: ${EVIDENCE_COMMAND_NAME}, 或 ${EVIDENCE_COMMAND_NAME} ${EVIDENCE_CHECK_ACTION} <仓库> <版本> <路径> <行号>.`,
  );
}

/**
 * 核对当前选型工单回执中的全部证据.
 *
 * @param {string} cwd 会话工作目录.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 没有选型工单, 回执不存在或没有证据表时.
 */
function verifyReceipt(cwd) {
  const context = openProject(cwd);
  const order = context.state.order;
  if (order === null || order.kind !== SELECTION_ORDER_KIND) {
    throw new WorkflowError(
      `当前没有选型工单; ${EVIDENCE_COMMAND_NAME} 只核对选型工单回执中的源码证据.`,
    );
  }
  const receipt = path.join(
    context.projectRoot,
    orderFilePath(order.folder, "receipt"),
  );
  if (!existsSync(receipt)) {
    throw new WorkflowError(`工单 ${order.id} 还没有回执文件.`);
  }
  return reportLines(
    readEvidenceRows(readFileSync(receipt, "utf8")),
    evidenceCacheDirectory(context.projectRoot),
  );
}

/**
 * 核对命令行给出的一条证据.
 *
 * @param {string} cwd 会话工作目录.
 * @param {string[]} values 仓库, 版本, 路径, 行号.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 不在 Git 仓库中时.
 */
function verifySingle(cwd, [repository, version, filePath, lines]) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    throw new WorkflowError("当前目录不是 Git 仓库.");
  }
  return reportLines(
    [{ ...SELF_CHECK_LABELS, repository, version, path: filePath, lines }],
    evidenceCacheDirectory(projectRoot),
  );
}

/**
 * 逐条核对证据, 输出每条的结果与汇总.
 *
 * @param {import("../lib/source-evidence.mjs").EvidenceRow[]} rows 各条证据.
 * @param {string} cacheRoot 源码缓存目录.
 * @returns {string[]} 输出各行.
 */
function reportLines(rows, cacheRoot) {
  const results = verifyEvidenceRows(rows, cacheRoot).map((result, index) => ({
    row: rows[index],
    ...result,
  }));
  const failed = results.filter((result) => result.excerpt === undefined);
  return [
    ...results.flatMap((result, index) => [
      ...formatEvidence({ index: index + 1, ...result }),
      "",
    ]),
    `- 核对结果: 共 ${rows.length} 条, 取到源码 ${rows.length - failed.length} 条, 取不到 ${failed.length} 条. 取不到源码的证据按未验证处理.`,
  ];
}
