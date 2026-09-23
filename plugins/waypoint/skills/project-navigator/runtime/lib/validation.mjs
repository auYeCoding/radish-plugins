/**
 * @file 工作流中共用的字段校验.
 */

import { WorkflowError } from "./workflow-error.mjs";

/**
 * 确认文字字段不为空.
 *
 * @param {unknown} value 字段值.
 * @param {string} label 字段名, 用于错误信息.
 * @returns {string} 去掉首尾空白的文字.
 * @throws {WorkflowError} 字段为空时.
 */
export function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkflowError(`${label}不能为空.`);
  }
  return value.trim();
}

/**
 * 确认值属于某组取值.
 *
 * @param {unknown} value 值.
 * @param {Readonly<Record<string, string>>} labels 允许的取值及其中文.
 * @param {string} label 字段名, 用于错误信息.
 * @returns {string} 值本身.
 * @throws {WorkflowError} 值不在允许范围内时.
 */
export function requireLabel(value, labels, label) {
  if (typeof value !== "string" || !Object.hasOwn(labels, value)) {
    throw new WorkflowError(
      `${label}应为 ${Object.keys(labels).join(", ")} 之一.`,
    );
  }
  return value;
}
