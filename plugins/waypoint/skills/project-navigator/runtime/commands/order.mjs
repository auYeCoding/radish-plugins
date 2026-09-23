/**
 * @file order 命令: 新建工单, 转换工单状态, 授权测试命令.
 *
 * 用法:
 * - order new --kind <类型> --slug <短名> [--slice <切片编号>]
 * - order set <状态>
 * - order tests --from <草稿>, 草稿格式 {"commands": ["npm test"]}
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";

import { issueBlocker } from "../lib/code-checks.mjs";
import { replyStep } from "../lib/guidance.mjs";
import { formatNumber } from "../lib/numbering.mjs";
import { orderFilePath, projectRelativePath } from "../lib/paths.mjs";
import { headCommit } from "../lib/repo.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
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
 * 转换当前工单状态. 发布前核对代码检查判据; 受阻后重新发布时, 先把旧回执改名归档,
 * 避免被当成新回执; 验收不通过时, 按同一切片连续不通过的次数提示使用哪组选项.
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
  if (status === "issued") {
    assertIssuable(context);
  }
  const next = setOrderStatus(
    context.state,
    status,
    headCommit(context.projectRoot),
  );
  const archived =
    order?.status === "blocked" && status === "issued"
      ? archiveReceipt(context.projectRoot, order.folder)
      : undefined;
  const state = saveState(context, next, now);
  const lines = resultLines(state);
  if (archived !== undefined) {
    lines.push(`- 旧回执已归档: ${archived}`);
  }
  if (status === "rejected") {
    lines.push(rejectionAction(context.spec, state, order?.slice ?? null));
  }
  return lines;
}

/**
 * 核对当前工单能否发布: 会改动代码的工单必须带代码检查判据.
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
  const orderFile = path.join(
    context.projectRoot,
    orderFilePath(order.folder, "order"),
  );
  const blocker = issueBlocker(
    context.state,
    existsSync(orderFile) ? readFileSync(orderFile, "utf8") : undefined,
  );
  if (blocker !== undefined) {
    throw new WorkflowError(blocker);
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
 * 验收不通过后的下一动作: 同一切片连续不通过达到阈值时重新拆分, 否则发布修复工单.
 *
 * @param {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @param {import("../lib/state.mjs").NavigatorState} state 写入后的状态.
 * @param {string | null} sliceId 工单所属切片.
 * @returns {string} 下一动作行.
 */
function rejectionAction(spec, state, sliceId) {
  const count = sliceId === null ? 0 : consecutiveRejections(state, sliceId);
  return count >= RESPLIT_THRESHOLD
    ? `- 下一动作: 切片 ${sliceId} 已连续 ${count} 次验收不通过, ${replyStep(spec, "验收报告", RESPLIT_OPTION)}`
    : `- 下一动作: ${replyStep(spec, "验收报告", FIX_OPTION)}; 用户选 A 后运行 order new --kind fix`;
}
