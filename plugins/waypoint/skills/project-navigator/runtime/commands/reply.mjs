/**
 * @file reply 命令: 输出某种回复的填写要求与骨架, "当前进展" 已按状态填好.
 * 不带回复类型时, 列出全部回复类型及其编号与选项组数. 验收中请用户人工验收之前,
 * 先核对验收记录的判据结论全部为通过. 摘录工单内容的回复 ("工单审阅") 按当前
 * 工单文件预填, 工单不在可审阅的状态或还不能发布时拒绝.
 */

import { buildLaunchPrompt } from "../lib/briefs.mjs";
import { issueBlocker } from "../lib/code-checks.mjs";
import { hasOrderExcerpt, orderExcerptBodies } from "../lib/order-excerpt.mjs";
import { readOrderText } from "../lib/order-approval.mjs";
import { orderFilePath } from "../lib/paths.mjs";
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
 * 可以请用户审阅的工单状态: 起草中, 以及受阻后修改待重新发布.
 * @type {readonly string[]}
 */
const REVIEWABLE_STATUSES = Object.freeze(["drafting", "blocked"]);

/**
 * 摘录工单内容的回复中, 由脚本填写工单文件路径的键.
 * @type {string}
 */
const ORDER_PATH_KEY = "文件路径";

/**
 * 执行 reply 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string | undefined} options.type 回复类型; 省略时列出全部类型.
 * @param {number} options.optionSet 使用第几组选项, 从 1 开始.
 * @returns {string[]} 输出各行.
 * @throws {Error} 回复类型或选项组不存在, 判据未全部通过却要请用户人工验收,
 * 或没有可审阅的工单时.
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
  const reply = spec.replies[resolvedType];
  const skeleton = renderReplySkeleton({
    type: resolvedType,
    optionSetIndex: optionSet - 1,
    state,
    spec,
    launchPrompt: order === null ? undefined : buildLaunchPrompt(order),
    bodies: hasOrderExcerpt(reply)
      ? excerptBodies({ projectRoot, state, reply, spec })
      : {},
  });
  return [
    ...renderReplyGuide({ type: resolvedType, role: reply.role, spec }),
    ...skeleton.trimEnd().split("\n"),
  ];
}

/**
 * 为摘录工单内容的回复生成各节正文. 工单要处于可审阅的状态, 工单文件已写好,
 * 且内容已满足发布条件: 用户审阅的必须是可以直接发布的内容.
 *
 * @param {object} options 参数.
 * @param {string | undefined} options.projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState | undefined} options.state 当前状态.
 * @param {import("../lib/spec.mjs").ReplySpec} options.reply 回复规格.
 * @param {import("../lib/spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {Record<string, string[]>} 节标题到正文的映射.
 * @throws {Error} 没有可审阅的工单, 工单文件不存在, 或内容还不能发布时.
 */
function excerptBodies({ projectRoot, state, reply, spec }) {
  const order = state?.order ?? null;
  if (
    projectRoot === undefined ||
    state === undefined ||
    order === null ||
    !REVIEWABLE_STATUSES.includes(order.status)
  ) {
    throw new Error(
      `reply: 当前没有待审阅的工单; 只有 ${REVIEWABLE_STATUSES.join(", ")} 状态的工单需要审阅.`,
    );
  }
  const orderText = readOrderText(projectRoot, order);
  const orderPath = orderFilePath(order.folder, "order");
  if (orderText === undefined) {
    throw new Error(`reply: 工单文件 ${orderPath} 还没有写入.`);
  }
  const blocker = issueBlocker(state, orderText);
  if (blocker !== undefined) {
    throw new Error(`reply: 工单还不能发布, 先改好再请用户审阅: ${blocker}`);
  }
  return orderExcerptBodies({
    reply,
    orderText,
    emptyValue: spec.format.emptyValue,
    extraValues: { [ORDER_PATH_KEY]: orderPath },
  });
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
