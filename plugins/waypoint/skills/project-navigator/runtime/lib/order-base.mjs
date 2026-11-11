/**
 * @file 工单的基准提交: 骨架预填, 审阅与发布前核对.
 *
 * 基准提交是执行子代理开工时仓库所在的提交: 执行子代理拿它与当前提交对账, 验收
 * 子代理拿它做 git diff. 工单文件与状态各记一份, 都以发布时的当前提交为准:
 * 骨架预填当前提交, 审阅与发布前核对工单文件中的值, 发布时把状态中的值更新为
 * 当前提交. 新建工单之后仓库有了新提交 (例如升级插件后的提交) 时, 两处不会不一致.
 */

import { findSection, readKeyValues } from "./layout.mjs";
import { headCommit } from "./repo.mjs";

/**
 * 工单文件中放基准提交的节, 与规格 files.order 中的节标题一致.
 * @type {string}
 */
const OVERVIEW_SECTION = "工单概况";

/**
 * 基准提交的键名, 与规格 files.order 中的键名一致.
 * @type {string}
 */
export const BASE_COMMIT_KEY = "基准提交";

/**
 * 工单文件中可以写提交哈希的缩写, 缩写至少这么多位.
 * @type {number}
 */
const MIN_ABBREVIATION_LENGTH = 7;

/**
 * 工单骨架中预填的键值: 基准提交写当前提交.
 *
 * @param {string | undefined} projectRoot 项目根目录.
 * @returns {Record<string, string>} 键名到值的映射; 仓库没有提交时为空.
 */
export function orderSkeletonValues(projectRoot) {
  const head = projectRoot === undefined ? undefined : headCommit(projectRoot);
  return head === undefined ? {} : { [BASE_COMMIT_KEY]: head };
}

/**
 * 读取工单文件中写的基准提交, 去掉行内代码的反引号.
 *
 * @param {string} orderText 工单文件内容.
 * @returns {string | undefined} 基准提交; 没有这个键时为 undefined.
 */
export function readOrderBaseCommit(orderText) {
  const section = findSection(orderText, OVERVIEW_SECTION);
  const value =
    section === undefined ? undefined : readKeyValues(section)[BASE_COMMIT_KEY];
  return value?.replaceAll("`", "").trim();
}

/**
 * 找出工单因基准提交不能审阅或发布的原因: 工单文件中的基准提交必须是当前提交.
 *
 * @param {object} options 核对参数.
 * @param {string} options.orderId 工单编号.
 * @param {string | undefined} options.orderText 工单文件内容; 文件不存在时为 undefined.
 * @param {string | undefined} options.head 当前提交的完整哈希; 仓库没有提交时为 undefined.
 * @returns {string | undefined} 原因, 写明补救办法; 一致时为 undefined.
 */
export function baseCommitBlocker({ orderId, orderText, head }) {
  if (head === undefined) {
    return "仓库还没有任何提交, 请先完成首次提交再发布工单.";
  }
  const written = readOrderBaseCommit(orderText ?? "");
  const isCurrent =
    written !== undefined &&
    written.length >= MIN_ABBREVIATION_LENGTH &&
    head.startsWith(written);
  return isCurrent
    ? undefined
    : `工单 ${orderId} 的 "${OVERVIEW_SECTION}" 中 "${BASE_COMMIT_KEY}" 写的是 "${written ?? "无"}", 当前提交是 ${head}: 执行子代理按当前提交对账, 验收子代理按基准提交比对改动. 把 "${BASE_COMMIT_KEY}" 改为 ${head}.`;
}
