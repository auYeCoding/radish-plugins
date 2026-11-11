/**
 * @file 验收记录的判据结论: 读取 review.md 的判据核对表, 按结论分类;
 * 核对等用户选择后才写的键已经写下.
 *
 * "有判据不通过时不能通过验收, 有未验证的判据时要用户明确接受" 由脚本执行:
 * order set accepted 与 "验收报告" 的选项组都先核对这里.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { findSection, readSectionTable } from "./layout.mjs";
import { orderFilePath } from "./paths.mjs";

/**
 * 验收记录中放判据结论的节, 与规格 files.review 中的节标题一致.
 * @type {string}
 */
export const CRITERIA_CHECK_SECTION = "判据核对";

/**
 * 判据核对表中写判据的列.
 * @type {string}
 */
export const CRITERION_COLUMN = "判据";

/**
 * 判据核对表中写结论的列, 取值由规格限定.
 * @type {string}
 */
export const VERDICT_COLUMN = "结论";

/**
 * 判据的三种结论, 与规格中判据核对表 "结论" 列允许的取值一致.
 * @type {Readonly<{pass: string, fail: string, unverified: string}>}
 */
export const VERDICTS = Object.freeze({
  pass: "通过",
  fail: "不通过",
  unverified: "未验证",
});

/**
 * 验收记录中等用户选择后才写的键. 骨架预填规格中的值, 用户选择之后改写.
 * @type {string}
 */
export const USER_VERDICT_KEY = "用户结论";

/**
 * @typedef {object} ReviewVerdicts 验收记录中判据结论的分类.
 * @property {string | undefined} problem 记录缺失或没有判据核对表时的原因.
 * @property {string[]} failed 结论为不通过的判据.
 * @property {string[]} unverified 结论为未验证, 或写了其它说法的判据.
 */

/**
 * 从规格中取出验收记录判据核对表的规格.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {import("./spec.mjs").TableSpec} 表格规格.
 * @throws {Error} 规格中没有该表格时.
 */
export function criteriaTableSpec(spec) {
  const table = spec.files.review.sections?.find(
    (section) => section.title === CRITERIA_CHECK_SECTION,
  )?.table;
  if (table === undefined) {
    throw new Error(
      `review-record: 规格中缺少 "${CRITERIA_CHECK_SECTION}" 的表格`,
    );
  }
  return table;
}

/**
 * 按结论给验收记录中的判据分类.
 *
 * @param {string | undefined} reviewText 验收记录全文; 文件不存在时为 undefined.
 * @returns {ReviewVerdicts} 分类结果.
 */
export function classifyVerdicts(reviewText) {
  if (reviewText === undefined) {
    return {
      problem: "验收记录 review.md 还没有写入.",
      failed: [],
      unverified: [],
    };
  }
  const section = findSection(reviewText, CRITERIA_CHECK_SECTION);
  const table = section === undefined ? undefined : readSectionTable(section);
  const criterionIndex = table?.headers.indexOf(CRITERION_COLUMN) ?? -1;
  const verdictIndex = table?.headers.indexOf(VERDICT_COLUMN) ?? -1;
  if (table === undefined || verdictIndex < 0 || table.rows.length === 0) {
    return {
      problem: `验收记录中没有 "${CRITERIA_CHECK_SECTION}" 表格.`,
      failed: [],
      unverified: [],
    };
  }
  const label = (row) => row[criterionIndex] ?? "";
  return {
    problem: undefined,
    failed: table.rows
      .filter((row) => row[verdictIndex] === VERDICTS.fail)
      .map(label),
    unverified: table.rows
      .filter(
        (row) =>
          row[verdictIndex] !== VERDICTS.pass &&
          row[verdictIndex] !== VERDICTS.fail,
      )
      .map(label),
  };
}

/**
 * 读取当前工单的验收记录, 按结论给判据分类.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{folder: string}} order 当前工单.
 * @returns {ReviewVerdicts} 分类结果.
 */
export function readOrderVerdicts(projectRoot, order) {
  const file = path.join(projectRoot, orderFilePath(order.folder, "review"));
  return classifyVerdicts(
    existsSync(file) ? readFileSync(file, "utf8") : undefined,
  );
}

/**
 * 检查验收记录中的用户结论是否已写: 键不存在, 值为空, 或仍是骨架预填的值时
 * 视为未写.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {{folder: string}} options.order 当前工单.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string | undefined} 未写时的原因; 已写时为 undefined.
 */
export function unfilledUserVerdict({ projectRoot, order, spec }) {
  const file = path.join(projectRoot, orderFilePath(order.folder, "review"));
  if (!existsSync(file)) {
    return "验收记录 review.md 还没有写入.";
  }
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith(`- ${USER_VERDICT_KEY}:`));
  const value = line?.slice(`- ${USER_VERDICT_KEY}:`.length).trim() ?? "";
  const preset = spec.files.review.sections?.find(
    (section) => section.presets?.[USER_VERDICT_KEY] !== undefined,
  )?.presets?.[USER_VERDICT_KEY];
  return value === "" || value === preset
    ? `review.md 的 "${USER_VERDICT_KEY}" 还是 "${value || "空"}", 先写下用户的选择.`
    : undefined;
}
