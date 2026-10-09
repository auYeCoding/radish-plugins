/**
 * @file 缺陷复查: 读 `.waypoint/defects/` 下的缺陷记录, 按模式键去重计数, 列出达到
 * 提升阈值的模式供用户迭代技能. 只读与统计, 不改技能, 不下根因结论.
 *
 * 用法: node <本文件> [起始目录] [--min-count N] [--min-tasks N] [--within-days N].
 * 从起始目录向上找 `.waypoint/`, 读其 defects/ 子目录里的 *.json.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { findDefectDir } from "../lib/defect-paths.mjs";
import {
  groupDefects,
  normalizeDefect,
  promotablePatterns,
} from "../lib/self-iteration.mjs";

/**
 * 默认提升阈值: 复现次数, 跨任务数, 最近时限 (天).
 * @type {Readonly<{minCount: number, minTasks: number, withinDays: number}>}
 */
const DEFAULT_THRESHOLD = Object.freeze({
  minCount: 3,
  minTasks: 2,
  withinDays: 30,
});

/**
 * 入口: 读缺陷, 分组, 打印统计与达阈值的模式.
 *
 * @returns {void}
 */
function main() {
  const { startDir, threshold } = parseArgs(process.argv.slice(2));
  const defectDir = findDefectDir(startDir);
  if (defectDir === undefined) {
    process.stdout.write("没有找到 .waypoint/ 点目录, 无缺陷可复查.\n");
    return;
  }
  const defects = readDefects(path.join(defectDir, "defects"));
  if (defects.length === 0) {
    process.stdout.write("缺陷收件目录为空, 没有待复查的记录.\n");
    return;
  }
  const groups = groupDefects(defects);
  const promotable = promotablePatterns(groups, {
    ...threshold,
    now: new Date(),
  });
  const lines = [
    `共 ${defects.length} 条缺陷记录, ${groups.length} 个模式.`,
    "",
    "全部模式 (按条数):",
    ...groups.map(
      (group) =>
        `- ${group.patternKey}: ${group.count} 条, 跨 ${group.tasks.length} 个任务, 涉及技能 ${group.skills.join("/") || "未注明"}`,
    ),
    "",
    `达到提升阈值的模式 (复现>=${threshold.minCount}, 跨任务>=${threshold.minTasks}, ${threshold.withinDays} 天内):`,
    ...(promotable.length === 0
      ? ["- 无. 未达阈值不提请改技能."]
      : promotable.map(
          (group) =>
            `- ${group.patternKey}: ${group.count} 条, 跨 ${group.tasks.length} 个任务. 值得提请用户看; 是否改技能由人按分类表归因后决定.`,
        )),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * 解析命令行参数.
 *
 * @param {readonly string[]} argv 参数 (不含 node 与脚本名).
 * @returns {{startDir: string, threshold: {minCount: number, minTasks: number, withinDays: number}}} 起始目录与阈值.
 */
function parseArgs(argv) {
  let startDir = process.cwd();
  const threshold = { ...DEFAULT_THRESHOLD };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--min-count") {
      threshold.minCount = toPositiveInteger(argv[++index], threshold.minCount);
    } else if (arg === "--min-tasks") {
      threshold.minTasks = toPositiveInteger(argv[++index], threshold.minTasks);
    } else if (arg === "--within-days") {
      threshold.withinDays = toPositiveInteger(
        argv[++index],
        threshold.withinDays,
      );
    } else if (!arg.startsWith("--")) {
      startDir = arg;
    }
  }
  return { startDir, threshold };
}

/**
 * 读收件目录里的全部缺陷记录.
 *
 * @param {string} inboxDir 收件目录.
 * @returns {import("../lib/self-iteration.mjs").DefectRecord[]} 缺陷记录.
 */
function readDefects(inboxDir) {
  if (!existsSync(inboxDir)) {
    return [];
  }
  return readdirSync(inboxDir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => parseDefectFile(path.join(inboxDir, name)));
}

/**
 * 解析一个缺陷文件; 损坏时跳过.
 *
 * @param {string} file 文件路径.
 * @returns {import("../lib/self-iteration.mjs").DefectRecord[]} 该文件里的记录 (0 或 1 条).
 */
function parseDefectFile(file) {
  try {
    return [normalizeDefect(JSON.parse(readFileSync(file, "utf8")))];
  } catch (error) {
    if (error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
}

/**
 * 把参数转成正整数; 非法时用回退值.
 *
 * @param {string | undefined} value 参数值.
 * @param {number} fallback 回退值.
 * @returns {number} 正整数.
 */
function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main();
