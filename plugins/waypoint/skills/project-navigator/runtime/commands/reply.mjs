/**
 * @file reply 命令: 输出某种回复的填写要求与骨架, "当前进展" 已按状态填好.
 * 不带回复类型时, 列出全部回复类型及其编号与选项组数. 验收中请用户人工验收之前,
 * 先核对验收记录的判据结论全部为通过.
 */

import { buildLaunchPrompt } from "../lib/briefs.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import { renderReplySkeleton } from "../lib/render.mjs";
import { renderReplyGuide } from "../lib/reply-guide.mjs";
import { orderAcceptanceBlockers } from "../lib/review-record.mjs";
import { loadSpec, resolveReplyType } from "../lib/spec.mjs";
import { readState } from "../lib/state.mjs";
import { renderTable } from "../lib/table.mjs";

/**
 * 请用户人工验收的回复类型.
 * @type {string}
 */
const REVIEW_REPLY_TYPE = "验收报告";

/**
 * "验收报告" 中请用户人工验收的选项组, 只在全部判据通过时使用.
 * @type {number}
 */
const MANUAL_ACCEPTANCE_OPTION = 1;

/**
 * 需要核对判据结论的工单状态: 验收中.
 * @type {string}
 */
const REVIEWING_STATUS = "reviewing";

/**
 * 执行 reply 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string | undefined} options.type 回复类型; 省略时列出全部类型.
 * @param {number} options.optionSet 使用第几组选项, 从 1 开始.
 * @returns {string[]} 输出各行.
 * @throws {Error} 回复类型或选项组不存在, 或判据未全部通过却要请用户人工验收时.
 */
export function runReply({ cwd, type, optionSet }) {
  const spec = loadSpec();
  if (type === undefined) {
    return listReplyTypes(spec);
  }
  const resolvedType = resolveReplyType(spec, type);
  if (resolvedType === undefined) {
    throw new Error(
      `reply: 未知的回复类型 "${type}", 不带参数运行 reply 查看全部类型`,
    );
  }
  const projectRoot = findRepositoryRoot(cwd);
  const state = projectRoot === undefined ? undefined : readState(projectRoot);
  const order = state?.order ?? null;
  if (
    projectRoot !== undefined &&
    order?.status === REVIEWING_STATUS &&
    resolvedType === REVIEW_REPLY_TYPE &&
    optionSet === MANUAL_ACCEPTANCE_OPTION
  ) {
    assertAllCriteriaPassed(projectRoot, order);
  }
  const skeleton = renderReplySkeleton({
    type: resolvedType,
    optionSetIndex: optionSet - 1,
    state,
    spec,
    launchPrompt: order === null ? undefined : buildLaunchPrompt(order),
  });
  return [
    ...renderReplyGuide({
      type: resolvedType,
      role: spec.replies[resolvedType].role,
      spec,
    }),
    ...skeleton.trimEnd().split("\n"),
  ];
}

/**
 * 核对验收记录中的判据结论全部为通过; 否则不能请用户人工验收.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{id: string, folder: string}} order 当前工单.
 * @returns {void}
 * @throws {Error} 有判据不是通过, 或验收记录缺失时.
 */
function assertAllCriteriaPassed(projectRoot, order) {
  const blockers = orderAcceptanceBlockers(projectRoot, order);
  if (blockers.length > 0) {
    throw new Error(
      `reply: 工单 ${order.id} 还不能请用户人工验收: ${blockers.join(" ")} 先运行 order set rejected, 再按输出使用第 2 或第 3 组选项.`,
    );
  }
}

/**
 * 列出全部回复类型: 类型, 编号, 选项组数.
 *
 * @param {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 表格各行.
 */
function listReplyTypes(spec) {
  return renderTable(
    ["回复类型", "编号", "选项组数"],
    Object.entries(spec.replies).map(([title, reply]) => [
      title,
      reply.id,
      String(reply.optionSets.length),
    ]),
  );
}
