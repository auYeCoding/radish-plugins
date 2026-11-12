/**
 * @file order 命令: 新建工单, 转换工单状态.
 *
 * 用法:
 * - order new --kind <类型> --slug <短名> [--slice <切片编号>]
 * - order set <状态> [--accept-unverified]
 */

import { existsSync, renameSync } from "node:fs";
import path from "node:path";

import { creationBlocker, issueBlocker } from "../lib/code-checks.mjs";
import { COMMIT_SKILL, SUBAGENT_TYPES } from "../lib/guard.mjs";
import {
  REVIEW_OPTIONS,
  REVIEW_REPLY_TYPE,
  RUNNING_REPLY_TYPE,
  replyStep,
} from "../lib/guidance.mjs";
import { formatNumber } from "../lib/numbering.mjs";
import {
  APPROVAL_REPLY_TYPE,
  APPROVAL_STATUSES,
  consumeApproval,
  digestOrderFile,
  readApprovalStatus,
  readOrderText,
} from "../lib/order-approval.mjs";
import { baseCommitBlocker } from "../lib/order-base.mjs";
import { orderFilePath, projectRelativePath } from "../lib/paths.mjs";
import { headCommit } from "../lib/repo.mjs";
import {
  readOrderVerdicts,
  unfilledUserVerdict,
} from "../lib/review-record.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  FIX_ORDER_KIND,
  ISSUED_ORDER_STATUS,
  SELECTION_ORDER_KIND,
  consecutiveRejections,
  createOrder,
  isRecordOnlyOrderKind,
  setOrderStatus,
} from "../lib/workflow-orders.mjs";
import { openProject, resultLines, saveState } from "./support.mjs";

/**
 * 同一切片连续验收不通过达到这个次数时, 提醒先考虑拆小工单或调整切片.
 * @type {number}
 */
const RESPLIT_THRESHOLD = 2;

/**
 * 派出执行子代理并回复 "工单执行" 的一串动作.
 * @type {string}
 */
const DISPATCH_ACTION = `运行 exec-brief, 把输出原样作为提示词, 用 Agent 工具在后台 (run_in_background) 派 ${SUBAGENT_TYPES.executor}`;

/**
 * 提交范围的写法, 验收通过后的提交使用.
 * @type {string}
 */
const COMMIT_SCOPE =
  "纳入范围: 回执改动清单中的文件, .navigator/ 下的改动, 以及插件命令改动的 .claude/settings.json 与 .claude/rules/engineering.md; 纳入范围之外的改动用文字列出并询问";

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
      return changeStatus(context, argument, values, now);
    default:
      throw new WorkflowError("order 的用法: new, set <状态>.");
  }
}

/**
 * 新建工单并输出工单文件的路径. 会改动代码的工单要求项目已登记检查命令.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {Record<string, any>} values 选项值.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 仓库没有提交, 参数不合法, 或缺少检查命令时.
 */
function createNewOrder(context, values, now) {
  const baseCommit = headCommit(context.projectRoot);
  if (baseCommit === undefined) {
    throw new WorkflowError("仓库还没有任何提交, 请先完成首次提交再发布工单.");
  }
  const created = createOrder(context.state, {
    kind: String(values.kind ?? ""),
    slug: String(values.slug ?? ""),
    slice: typeof values.slice === "string" ? values.slice : undefined,
    baseCommit,
  });
  const blocker = creationBlocker(context.state, created.order.kind);
  if (blocker !== undefined) {
    throw new WorkflowError(blocker);
  }
  const state = saveState(context, created, now);
  const orderFile = path.join(
    context.projectRoot,
    orderFilePath(state.order.folder, "order"),
  );
  return [
    ...resultLines(state),
    `- 下一动作: 运行 template order 取得骨架, 用 Write 写入 ${orderFile}, 再${replyStep(context.spec, APPROVAL_REPLY_TYPE)}; 用户选 A 后运行 order set issued`,
  ];
}

/**
 * 转换当前工单状态. 发布前核对代码检查判据与用户审阅, 发布时把旧回执改名归档;
 * 通过验收前核对验收记录的判据结论; 验收不通过时提示下一动作.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {string | undefined} status 目标状态.
 * @param {Record<string, any>} values 选项值.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 缺少目标状态, 或不满足转换条件时.
 */
function changeStatus(context, status, values, now) {
  if (status === undefined) {
    throw new WorkflowError("order set 缺少目标状态.");
  }
  const order = context.state.order;
  if (status === ISSUED_ORDER_STATUS) {
    return issueOrder(context, now);
  }
  if (status === "accepted" && order?.status === "reviewing") {
    assertAcceptable(context, values["accept-unverified"] === true);
  }
  const state = saveState(context, setOrderStatus(context.state, status), now);
  const lines = resultLines(state);
  if (status === "accepted" && order !== null) {
    lines.push(
      `- 下一动作: 按用户在 "${REVIEW_REPLY_TYPE}" 中的选择调用 ${COMMIT_SKILL}: 只提交时参数写 "提交, ${COMMIT_SCOPE}"; 提交并推送时写 "提交并推送, ${COMMIT_SCOPE}"`,
    );
  }
  if (status === "rejected" && order !== null) {
    lines.push(rejectionAction(context.spec, state, order));
  }
  return lines;
}

/**
 * 发布当前工单: 核对能否发布, 把旧回执改名归档, 记下发布时的工单内容与当前
 * 提交 (基准提交), 用掉审阅. 受阻后内容没有改动的工单直接继续, 由原执行子代理
 * 接着做, 基准提交不变.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 不能发布时.
 */
function issueOrder(context, now) {
  const order = context.state.order;
  if (order === null) {
    throw new WorkflowError("当前没有工单.");
  }
  const isContinuing = assertIssuable(context);
  const archived = archiveReceipt(context.projectRoot, order.folder);
  const state = saveState(
    context,
    setOrderStatus(context.state, ISSUED_ORDER_STATUS, {
      issuedDigest: digestOrderFile(context.projectRoot, order),
      baseCommit: isContinuing ? undefined : headCommit(context.projectRoot),
    }),
    now,
  );
  consumeApproval(context.projectRoot);
  const running = replyStep(context.spec, RUNNING_REPLY_TYPE);
  return [
    ...resultLines(state),
    ...(archived === undefined ? [] : [`- 旧回执已归档: ${archived}`]),
    isContinuing
      ? `- 下一动作: 用 SendMessage 让原执行子代理继续 (说明用户已完成的操作); 找不到它时${DISPATCH_ACTION}; 然后${running}`
      : `- 下一动作: ${DISPATCH_ACTION}, 然后${running}`,
  ];
}

/**
 * 核对当前工单能否发布: 会改动代码的工单必须带代码检查判据; 用户必须已在
 * "工单审阅" 中认可当前的工单内容, 且工单文件中的基准提交是当前提交; 或工单
 * 受阻后内容与上次发布时相同.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @returns {boolean} 是受阻后内容没有改动的继续发布时返回 true.
 * @throws {WorkflowError} 不能发布时, 原因写明补救办法.
 */
function assertIssuable(context) {
  const order = /** @type {import("../lib/state.mjs").OrderState} */ (
    context.state.order
  );
  const blocker = issueBlocker(
    context.state,
    readOrderText(context.projectRoot, order),
  );
  if (blocker !== undefined) {
    throw new WorkflowError(blocker);
  }
  const approval = readApprovalStatus(context.projectRoot, order);
  if (approval === APPROVAL_STATUSES.approved) {
    assertBaseCommitCurrent(context, order);
    return false;
  }
  if (
    order.status === "blocked" &&
    order.issuedDigest !== undefined &&
    order.issuedDigest === digestOrderFile(context.projectRoot, order)
  ) {
    return true;
  }
  throw new WorkflowError(
    approval === APPROVAL_STATUSES.awaiting
      ? `工单 ${order.id} 正在等用户审阅: 用户在 "${APPROVAL_REPLY_TYPE}" 中选 A 之后才能发布.`
      : `工单 ${order.id} 还没有经用户审阅, 或审阅之后内容有改动: 先${replyStep(context.spec, APPROVAL_REPLY_TYPE)}并结束本轮, 用户选 A 后再运行 order set issued. 只运行 reply 命令不算审阅.`,
  );
}

/**
 * 核对工单文件中的基准提交是当前提交. 审阅时已核对过一次; 审阅之后仓库又有了
 * 新提交时在这里拒绝, 改好后要重新审阅.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {import("../lib/state.mjs").OrderState} order 当前工单.
 * @returns {void}
 * @throws {WorkflowError} 基准提交不是当前提交时.
 */
function assertBaseCommitCurrent(context, order) {
  const blocker = baseCommitBlocker({
    orderId: order.id,
    orderText: readOrderText(context.projectRoot, order),
    head: headCommit(context.projectRoot),
  });
  if (blocker !== undefined) {
    throw new WorkflowError(
      `${blocker} 改好后${replyStep(context.spec, APPROVAL_REPLY_TYPE)}, 用户选 A 后再运行 order set issued.`,
    );
  }
}

/**
 * 核对当前工单能否通过验收: 不能有不通过的判据; 有未验证的判据时, 要用户
 * 在 "验收报告" 中明确接受. 选型工单例外: 是否采用由用户在看过逐条核对结果
 * 之后决定. 两种工单都要求验收记录中已写下用户结论.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {boolean} isUnverifiedAccepted 用户是否已接受未验证的判据.
 * @returns {void}
 * @throws {WorkflowError} 不能通过验收时, 原因写明下一步.
 */
function assertAcceptable(context, isUnverifiedAccepted) {
  const order = /** @type {import("../lib/state.mjs").OrderState} */ (
    context.state.order
  );
  const verdicts = readOrderVerdicts(context.projectRoot, order);
  if (verdicts.problem !== undefined) {
    throw new WorkflowError(
      `工单 ${order.id} 不能通过验收: ${verdicts.problem}`,
    );
  }
  if (order.kind !== SELECTION_ORDER_KIND) {
    if (verdicts.failed.length > 0) {
      throw new WorkflowError(
        `工单 ${order.id} 不能通过验收: 判据 ${verdicts.failed.map((item) => `"${item}"`).join(", ")} 不通过. 运行 order set rejected, 按输出处理.`,
      );
    }
    if (verdicts.unverified.length > 0 && !isUnverifiedAccepted) {
      throw new WorkflowError(
        `工单 ${order.id} 有未验证的判据: ${verdicts.unverified.map((item) => `"${item}"`).join(", ")}. 用 "${REVIEW_REPLY_TYPE}" 第 ${REVIEW_OPTIONS.unverified} 组请用户决定; 用户接受时运行 order set accepted --accept-unverified.`,
      );
    }
  }
  const unfilled = unfilledUserVerdict({
    projectRoot: context.projectRoot,
    order,
    spec: context.spec,
  });
  if (unfilled !== undefined) {
    throw new WorkflowError(unfilled);
  }
}

/**
 * 把回执改名为下一个未占用的归档名, 例如 receipt-0001.md.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} folder 工单文件夹名.
 * @returns {string | undefined} 归档后的项目相对路径; 没有回执时为 undefined.
 */
function archiveReceipt(projectRoot, folder) {
  const receipt = path.join(projectRoot, orderFilePath(folder, "receipt"));
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
  return projectRelativePath(projectRoot, archivedName(round));
}

/**
 * 验收不通过后的下一动作, 按工单类型分三种:
 * - 选型工单只在用户选择另选方案之后才转为不通过, 下一步按用户给出的方向新建
 *   选型工单 (检查命令在选型采用后才登记, 不能发修复工单).
 * - 运行检查与分析工单只产出记录, 补正就是在同一切片重发同类工单.
 * - 其余工单先判断不通过的原因: 工单太大就拆小, 规格不清或实现有误就发修复工单.
 *   同一切片连续不通过时另加提醒.
 *
 * @param {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @param {import("../lib/state.mjs").NavigatorState} state 写入后的状态.
 * @param {{kind: string, slice: string | null}} order 被判为不通过的工单.
 * @returns {string} 下一动作行.
 */
function rejectionAction(spec, state, order) {
  if (order.kind === SELECTION_ORDER_KIND) {
    return `- 下一动作: 按用户在 "${REVIEW_REPLY_TYPE}" 第 ${REVIEW_OPTIONS.selection} 组选 B 时给出的方向, 运行 order new --kind ${SELECTION_ORDER_KIND} 新建选型工单`;
  }
  const remedyStep = replyStep(spec, REVIEW_REPLY_TYPE, REVIEW_OPTIONS.fix);
  const sliceFlag = order.slice === null ? "" : ` --slice ${order.slice}`;
  if (isRecordOnlyOrderKind(order.kind)) {
    return `- 下一动作: ${remedyStep}; 用户选 A 后运行 order new --kind ${order.kind}${sliceFlag}, 重发同类工单 (这类工单只产出记录, 不发修复工单)`;
  }
  const count =
    order.slice === null ? 0 : consecutiveRejections(state, order.slice);
  const warning =
    count >= RESPLIT_THRESHOLD
      ? ` 切片 ${order.slice} 已连续 ${count} 次不通过, 优先考虑工单是否太大.`
      : "";
  return `- 下一动作: ${remedyStep}; 用户选 A 后先判断不通过的原因: 工单超出一次执行或验收的能力时拆成更小的工单 (需要时更新推进路线), 规格不清或实现有误时运行 order new --kind ${FIX_ORDER_KIND}${sliceFlag}.${warning}`;
}
