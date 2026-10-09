/**
 * @file 案卷校验器: 核对每条结论都带位置证据 (where 非空).
 * 零项必须失败 — 没有任何结论可查时报失败, 不报通过 (抽查或空查不算通过).
 *
 * 位置证据检查同时兜住另外两条纪律里能确定性强制的那部分: 没有 where 的结论正是
 * "工具输出未经验证就当已证实" 与 "拿语气笃定当判据" 的可观测残留. 这两条纪律的
 * 其余部分 (验证时序, 不伪造验证产物) 无法确定性校验, 靠技能正文约束.
 *
 * 用法: node <本文件> [起始目录]. 从起始目录向上找 `.tracepoint/case.json`.
 * 全部结论都带位置证据且至少有一条时以退出码 0 结束, 否则以退出码 1 结束.
 */

import { readCase } from "../lib/case-file.mjs";
import { findCaseDir } from "../lib/paths.mjs";

/**
 * 校验失败时的退出码.
 * @type {number}
 */
const EXIT_FAILURE = 1;

/**
 * 入口: 定位案卷, 校验结论, 按结果设置退出码.
 *
 * @returns {void}
 */
function main() {
  const startDir = process.argv[2] ?? process.cwd();
  const caseDir = findCaseDir(startDir);
  if (caseDir === undefined) {
    fail(["没有找到 .tracepoint/ 案卷; 先建案卷再分析."]);
    return;
  }
  const data = readCase(caseDir);
  if (data.findings.length === 0) {
    fail([
      "案卷里一条结论都没有: 零项必须失败, 不是通过. 要么还没有可下的结论, 要么结论没记进案卷.",
    ]);
    return;
  }
  const missing = data.findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => !hasText(finding.where));
  if (missing.length > 0) {
    fail([
      `有 ${missing.length} 条结论没有位置证据; 补上依据的地址/片段, 或降级为案卷里的待解问题:`,
      ...missing.map(
        ({ finding, index }) => `  ${index + 1}. ${truncate(finding.text)}`,
      ),
    ]);
    return;
  }
  process.stdout.write(
    `检查通过. ${data.findings.length} 条结论都带位置证据.\n`,
  );
}

/**
 * 打印失败信息并设置失败退出码.
 *
 * @param {readonly string[]} lines 失败信息各行.
 * @returns {void}
 */
function fail(lines) {
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = EXIT_FAILURE;
}

/**
 * 截断过长的结论文字用于报告.
 *
 * @param {string} text 结论文字.
 * @returns {string} 截断后的文字.
 */
function truncate(text) {
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

/**
 * 判断是否为非空文字.
 *
 * @param {unknown} value 任意值.
 * @returns {boolean} 是非空文字时返回 true.
 */
function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

main();
