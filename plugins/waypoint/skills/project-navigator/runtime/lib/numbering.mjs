/**
 * @file 编号的分配与格式化: 各类编号全局连续, 显示为 4 位补零.
 */

/**
 * 编号显示的位数.
 * @type {number}
 */
export const NUMBER_WIDTH = 4;

/**
 * 把数字格式化为 4 位补零的编号, 例如 7 → "0007".
 *
 * @param {number} value 数字.
 * @returns {string} 编号.
 */
export function formatNumber(value) {
  return String(value).padStart(NUMBER_WIDTH, "0");
}

/**
 * 分配某一类的下一个编号, 返回编号与更新后的计数器, 不修改传入的状态.
 *
 * @param {Record<string, number>} counters 状态中的 `next` 计数器.
 * @param {string} kind 编号类别, 例如 order, slice.
 * @returns {{id: string, next: Record<string, number>}} 新编号与新计数器.
 */
export function allocateNumber(counters, kind) {
  const value = counters[kind] ?? 1;
  return { id: formatNumber(value), next: { ...counters, [kind]: value + 1 } };
}
