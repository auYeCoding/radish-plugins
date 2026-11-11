/**
 * @file reply 命令: 输出某种回复的填写要求与骨架, 进展行已按状态填好.
 * 不带回复类型时, 列出全部回复类型及其编号与选项组数.
 *
 * "工单审阅" 按当前工单文件的 "审阅要点" 预填, 工单不在可审阅的状态或还不能
 * 发布时拒绝. "验收报告" 的选项组按验收记录的判据结论核对: 全部通过才能用
 * 第 1 组, 只有未验证 (没有不通过) 才能用第 3 组, 选型工单只用第 4 组.
 */

import { issueBlocker } from "../lib/code-checks.mjs";
import { REVIEW_OPTIONS, REVIEW_REPLY_TYPE } from "../lib/guidance.mjs";
import { findSection, readKeyValues } from "../lib/layout.mjs";
import { APPROVAL_REPLY_TYPE, readOrderText } from "../lib/order-approval.mjs";
import { orderFilePath } from "../lib/paths.mjs";
import { renderReplySkeleton } from "../lib/render.mjs";
import { renderReplyGuide } from "../lib/reply-guide.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import { readOrderVerdicts } from "../lib/review-record.mjs";
import { loadSpec, resolveReplyType } from "../lib/spec.mjs";
import { readStateIfValid } from "../lib/state.mjs";
import { renderTable } from "../lib/table.mjs";
import { SELECTION_ORDER_KIND } from "../lib/workflow-orders.mjs";

/**
 * 工单文件中写给人看的节, 与规格 files.order 中的节标题一致.
 * @type {string}
 */
const ORDER_SUMMARY_SECTION = "审阅要点";

/**
 * "工单审阅" 中由脚本填写工单文件路径的键.
 * @type {string}
 */
const ORDER_PATH_KEY = "工单文件";

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
 * 执行 reply 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string | undefined} options.type 回复类型; 省略时列出全部类型.
 * @param {number} options.optionSet 使用第几组选项, 从 1 开始.
 * @returns {string[]} 输出各行.
 * @throws {Error} 回复类型或选项组不存在, 选项组与判据结论不符, 或没有可审阅的工单时.
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
  const state =
    projectRoot === undefined ? undefined : readStateIfValid(projectRoot);
  const order = state?.order ?? null;
  if (
    projectRoot !== undefined &&
    order?.status === REVIEWING_STATUS &&
    resolvedType === REVIEW_REPLY_TYPE
  ) {
    assertReviewOption(projectRoot, order, optionSet);
  }
  const skeleton = renderReplySkeleton({
    type: resolvedType,
    optionSetIndex: optionSet - 1,
    state,
    spec,
    values:
      resolvedType === APPROVAL_REPLY_TYPE
        ? approvalValues(projectRoot, state)
        : {},
  });
  return [
    ...renderReplyGuide({
      type: resolvedType,
      spec,
      optionSetIndex: optionSet - 1,
    }),
    ...skeleton.trimEnd().split("\n"),
  ];
}

/**
 * 为 "工单审阅" 取出预填的值: 工单文件 "审阅要点" 中的各键, 以及工单文件路径.
 * 工单要处于可审阅的状态, 工单文件已写好, 且内容已满足发布条件.
 *
 * @param {string | undefined} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState | undefined} state 当前状态.
 * @returns {Record<string, string>} 键名到值的映射.
 * @throws {Error} 没有可审阅的工单, 工单文件不存在, 或内容还不能发布时.
 */
function approvalValues(projectRoot, state) {
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
  const section = findSection(orderText, ORDER_SUMMARY_SECTION);
  return {
    ...(section === undefined ? {} : readKeyValues(section)),
    [ORDER_PATH_KEY]: orderPath,
  };
}

/**
 * 核对 "验收报告" 的选项组与判据结论相符: 选型工单只用采用与否的一组; 其它工单
 * 判据全部通过才能用验收通过的一组, 只有未验证的判据才能用接受现状的一组.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{id: string, folder: string, kind: string}} order 当前工单.
 * @param {number} optionSet 选项组号.
 * @returns {void}
 * @throws {Error} 选项组与判据结论不符时.
 */
function assertReviewOption(projectRoot, order, optionSet) {
  const isSelection = order.kind === SELECTION_ORDER_KIND;
  if (isSelection !== (optionSet === REVIEW_OPTIONS.selection)) {
    throw new Error(
      isSelection
        ? `reply: 选型工单使用 "${REVIEW_REPLY_TYPE}" 第 ${REVIEW_OPTIONS.selection} 组选项, 由用户决定是否采用选型结论.`
        : `reply: 第 ${REVIEW_OPTIONS.selection} 组选项只用于选型工单.`,
    );
  }
  const verdicts = readOrderVerdicts(projectRoot, order);
  const isPassed =
    verdicts.problem === undefined &&
    verdicts.failed.length === 0 &&
    verdicts.unverified.length === 0;
  const isUnverifiedOnly =
    verdicts.problem === undefined &&
    verdicts.failed.length === 0 &&
    verdicts.unverified.length > 0;
  if (optionSet === REVIEW_OPTIONS.passed && !isPassed) {
    throw new Error(
      `reply: 工单 ${order.id} 的判据没有全部通过, 不能用第 ${REVIEW_OPTIONS.passed} 组: ${verdicts.problem ?? "有判据不通过或未验证"}. 有不通过时运行 order set rejected 后用第 ${REVIEW_OPTIONS.fix} 组, 只有未验证时用第 ${REVIEW_OPTIONS.unverified} 组.`,
    );
  }
  if (optionSet === REVIEW_OPTIONS.unverified && !isUnverifiedOnly) {
    throw new Error(
      `reply: 第 ${REVIEW_OPTIONS.unverified} 组只用于没有不通过, 但有未验证判据的工单.`,
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
