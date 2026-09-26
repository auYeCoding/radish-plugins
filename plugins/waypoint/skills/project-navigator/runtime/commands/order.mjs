/**
 * @file order 命令: 新建工单, 转换工单状态, 授权测试命令.
 *
 * 用法:
 * - order new --kind <类型> --slug <短名> [--slice <切片编号>]
 * - order set <状态>
 * - order tests --from <草稿>, 草稿格式 {"commands": ["npm test"]}
 */

import { existsSync, renameSync } from "node:fs";
import path from "node:path";

import { issueBlocker } from "../lib/code-checks.mjs";
import { replyStep } from "../lib/guidance.mjs";
import { formatNumber } from "../lib/numbering.mjs";
import {
  APPROVAL_REPLY_TYPE,
  APPROVAL_STATUSES,
  consumeApproval,
  readApprovalStatus,
  readOrderText,
} from "../lib/order-approval.mjs";
import { orderFilePath, projectRelativePath } from "../lib/paths.mjs";
import { COMMIT_SKILL } from "../lib/guard.mjs";
import { headCommit, listUncommittedPaths } from "../lib/repo.mjs";
import { orderAcceptanceBlockers } from "../lib/review-record.mjs";
import { COMMITTED_PATHSPECS } from "../lib/tracked-paths.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  SELECTION_ORDER_KIND,
  authorizeTests,
  consecutiveRejections,
  createOrder,
  setOrderStatus,
} from "../lib/workflow-orders.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 发布状态.
 * @type {string}
 */
const ISSUED_STATUS = "issued";

/**
 * 发布工单的回复类型.
 * @type {string}
 */
const ISSUE_REPLY_TYPE = "工单发布";

/**
 * 同一切片连续验收不通过达到这个次数时, 提示重新拆分切片.
 * @type {number}
 */
const RESPLIT_THRESHOLD = 2;

/**
 * "验收报告" 中发布修复工单的选项组.
 * @type {number}
 */
const FIX_OPTION = 2;

/**
 * "验收报告" 中重新拆分切片的选项组.
 * @type {number}
 */
const RESPLIT_OPTION = 3;

/**
 * 执行 order 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法时.
 */
export function runOrder({ positionals, values, cwd, now }) {
  const context = openProject(cwd);
  const [action, argument] = positionals;
  switch (action) {
    case "new":
      return createNewOrder(context, values, now);
    case "set":
      return changeStatus(context, argument, now);
    case "tests": {
      const draft = readDraftJson(context.projectRoot, values.from);
      const commands = Array.isArray(draft.commands)
        ? draft.commands.map(String)
        : [];
      return resultLines(
        saveState(context, authorizeTests(context.state, commands), now),
      );
    }
    default:
      throw new WorkflowError(
        "order 的用法: new, set <状态>, tests --from <草稿>.",
      );
  }
}

/**
 * 新建工单并输出工单文件夹的路径.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {Record<string, any>} values 选项值.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function createNewOrder(context, values, now) {
  const baseCommit = headCommit(context.projectRoot);
  if (baseCommit === undefined) {
    throw new WorkflowError("仓库还没有任何提交, 请先完成首次提交再发布工单.");
  }
  const state = saveState(
    context,
    createOrder(context.state, {
      kind: String(values.kind ?? ""),
      slug: String(values.slug ?? ""),
      slice: typeof values.slice === "string" ? values.slice : undefined,
      baseCommit,
    }),
    now,
  );
  const orderFile = path.join(
    context.projectRoot,
    orderFilePath(state.order.folder, "order"),
  );
  return [
    ...resultLines(state),
    `- 下一动作: 用 Write 写入 ${orderFile}, 再运行 order set issued`,
  ];
}

/**
 * 转换当前工单状态. 发布前核对代码检查判据与用户审阅; 通过验收前核对验收记录的
 * 判据结论; 重新发布时, 先把旧回执改名归档, 避免被当成新回执, 发布后用掉审阅
 * 记录; 验收不通过时, 按工单类型与同一切片连续不通过的次数提示下一动作.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {string | undefined} status 目标状态.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function changeStatus(context, status, now) {
  if (status === undefined) {
    throw new WorkflowError("order set 缺少目标状态.");
  }
  const order = context.state.order;
  const isIssuing = status === ISSUED_STATUS;
  if (isIssuing) {
    assertIssuable(context);
  }
  if (status === "accepted" && order?.status === "reviewing") {
    assertAcceptable(context);
  }
  if (status === "committed") {
    assertCommitted(context);
  }
  const next = setOrderStatus(
    context.state,
    status,
    headCommit(context.projectRoot),
  );
  const archived =
    isIssuing && order !== null
      ? archiveReceipt(context.projectRoot, order.folder)
      : undefined;
  const state = saveState(context, next, now, {
    writtenPaths: archived === undefined ? [] : [archived.from, archived.to],
  });
  if (isIssuing) {
    consumeApproval(context.projectRoot);
  }
  const lines = resultLines(state);
  if (archived !== undefined) {
    lines.push(`- 旧回执已归档: ${archived.to}`);
  }
  if (status === "rejected" && order !== null) {
    lines.push(rejectionAction(context.spec, state, order));
  }
  return lines;
}

/**
 * 核对当前工单能否通过验收: 验收记录的判据核对表中每条都必须是通过.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @returns {void}
 * @throws {WorkflowError} 有判据不是通过, 或验收记录缺失时, 原因写明下一步.
 */
function assertAcceptable(context) {
  const order = context.state.order;
  if (order === null) {
    return;
  }
  const blockers = orderAcceptanceBlockers(context.projectRoot, order);
  if (blockers.length > 0) {
    throw new WorkflowError(
      `工单 ${order.id} 不能通过验收: ${blockers.join(" ")} 有判据不通过或未验证时运行 order set rejected, 按输出处理.`,
    );
  }
}

/**
 * 核对当前工单能否发布: 会改动代码的工单必须带代码检查判据; 用户必须已在
 * "工单审阅" 中认可当前的工单内容.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @returns {void}
 * @throws {WorkflowError} 不能发布时, 原因写明补救办法.
 */
function assertIssuable(context) {
  const order = context.state.order;
  if (order === null) {
    return;
  }
  const blocker = issueBlocker(
    context.state,
    readOrderText(context.projectRoot, order),
  );
  if (blocker !== undefined) {
    throw new WorkflowError(blocker);
  }
  const approval = readApprovalStatus(context.projectRoot, order);
  if (approval === APPROVAL_STATUSES.approved) {
    return;
  }
  const { spec } = context;
  throw new WorkflowError(
    approval === APPROVAL_STATUSES.awaiting
      ? `工单 ${order.id} 正在等用户审阅: 用户在 "${APPROVAL_REPLY_TYPE}" 中选 A 之后才能发布.`
      : `工单 ${order.id} 还没有经用户审阅, 或审阅之后内容有改动: 先${replyStep(spec, APPROVAL_REPLY_TYPE)}, 用户选 A 后再运行 order set issued, 然后${replyStep(spec, ISSUE_REPLY_TYPE)}.`,
  );
}

/**
 * 核对提交已经完整: 状态目录与插件管理的项目配置中没有未入库的文件. 被提交漏掉的
 * 记录要在提交步骤中补交, 不能等到以后.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @returns {void}
 * @throws {WorkflowError} 仍有未入库的文件时, 原因列出文件并写明补救办法.
 */
function assertCommitted(context) {
  const uncommitted = listUncommittedPaths(
    context.projectRoot,
    COMMITTED_PATHSPECS,
  );
  if (uncommitted.length > 0) {
    throw new WorkflowError(
      `以下文件没有随提交入库: ${uncommitted.join(", ")}. 再次调用 ${COMMIT_SKILL}, 参数写 "提交, 纳入范围: ${uncommitted.join(", ")}; 纳入范围之外的改动用文字列出并询问", 提交之后重新运行 order set committed.`,
    );
  }
}

/**
 * 把回执改名为下一个未占用的归档名, 例如 receipt-0001.md.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} folder 工单文件夹名.
 * @returns {{from: string, to: string} | undefined} 归档前后的项目相对路径; 没有回执时为 undefined.
 */
function archiveReceipt(projectRoot, folder) {
  const from = orderFilePath(folder, "receipt");
  const receipt = path.join(projectRoot, from);
  if (!existsSync(receipt)) {
    return undefined;
  }
  const { name, ext } = path.parse(receipt);
  const archivedName = (round) =>
    path.join(path.dirname(receipt), `${name}-${formatNumber(round)}${ext}`);
  let round = 1;
  while (existsSync(archivedName(round))) {
    round += 1;
  }
  renameSync(receipt, archivedName(round));
  return { from, to: projectRelativePath(projectRoot, archivedName(round)) };
}

/**
 * 验收不通过后的下一动作: 选型工单重新发布选型工单 (修复工单要求已登记检查命令,
 * 而检查命令在选型通过后才登记); 同一切片连续不通过达到阈值时重新拆分;
 * 其余情况发布修复工单.
 *
 * @param {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @param {import("../lib/state.mjs").NavigatorState} state 写入后的状态.
 * @param {{kind: string, slice: string | null}} order 被判为不通过的工单.
 * @returns {string} 下一动作行.
 */
function rejectionAction(spec, state, order) {
  const fixStep = replyStep(spec, "验收报告", FIX_OPTION);
  if (order.kind === SELECTION_ORDER_KIND) {
    return `- 下一动作: ${fixStep}; 用户选 A 后运行 order new --kind ${SELECTION_ORDER_KIND}, 新工单的判据写明要补正的问题`;
  }
  const count =
    order.slice === null ? 0 : consecutiveRejections(state, order.slice);
  return count >= RESPLIT_THRESHOLD
    ? `- 下一动作: 切片 ${order.slice} 已连续 ${count} 次验收不通过, ${replyStep(spec, "验收报告", RESPLIT_OPTION)}`
    : `- 下一动作: ${fixStep}; 用户选 A 后运行 order new --kind fix`;
}
