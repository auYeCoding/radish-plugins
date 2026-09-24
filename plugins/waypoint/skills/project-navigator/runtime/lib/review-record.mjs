/**
 * @file 验收记录的判据结论: 读取 review.md 的判据核对表, 找出妨碍验收通过的判据.
 *
 * "有判据不通过或未验证时不能通过验收" 由脚本执行: order set accepted 与
 * "验收报告" 请用户人工验收的选项组都先核对这里.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readSectionTable, splitSections } from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
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
 * 找出验收记录中妨碍验收通过的原因.
 *
 * @param {string | undefined} reviewText 验收记录全文; 文件不存在时为 undefined.
 * @returns {string[]} 原因列表; 为空表示全部判据通过.
 */
export function acceptanceBlockers(reviewText) {
  if (reviewText === undefined) {
    return ["验收记录 review.md 还没有写入."];
  }
  const section = splitSections(parseMarkdown(reviewText)).sections.find(
    (entry) => entry.title === CRITERIA_CHECK_SECTION,
  );
  const table = section === undefined ? undefined : readSectionTable(section);
  const criterionIndex = table?.headers.indexOf(CRITERION_COLUMN) ?? -1;
  const verdictIndex = table?.headers.indexOf(VERDICT_COLUMN) ?? -1;
  if (table === undefined || verdictIndex < 0 || table.rows.length === 0) {
    return [`验收记录中没有 "${CRITERIA_CHECK_SECTION}" 表格.`];
  }
  return table.rows
    .filter((row) => row[verdictIndex] !== VERDICTS.pass)
    .map(
      (row) =>
        `判据 "${row[criterionIndex] ?? ""}" 的结论为 "${row[verdictIndex] ?? ""}".`,
    );
}

/**
 * 读取当前工单的验收记录, 找出妨碍验收通过的原因.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{folder: string}} order 当前工单.
 * @returns {string[]} 原因列表; 为空表示全部判据通过.
 */
export function orderAcceptanceBlockers(projectRoot, order) {
  const file = path.join(projectRoot, orderFilePath(order.folder, "review"));
  return acceptanceBlockers(
    existsSync(file) ? readFileSync(file, "utf8") : undefined,
  );
}
