/**
 * @file enter 与 status 命令: 检查环境与初始化情况, 对账, 登记编排会话,
 * 输出当前状态与下一动作.
 *
 * enter 由技能加载时的 `!` 命令调用, 输出会原样注入技能内容, 因此必须始终以
 * 退出码 0 结束, 且输出中只含由状态决定的内容. status 只查询, 不写任何文件.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { checkEnvironment } from "../lib/environment.mjs";
import { ANOMALY_GUIDES, nextAction } from "../lib/guidance.mjs";
import {
  PROBE_FILE,
  PROJECT_COMMAND_PATH,
  PROJECT_SETTINGS_FILE,
  STATE_FILE,
  navigatorPath,
  orderFilePath,
} from "../lib/paths.mjs";
import { RECONCILE_LABELS, reconcile } from "../lib/reconcile.mjs";
import { renderProgressSection } from "../lib/render.mjs";
import { countTrackedFiles, readGitBlob, shortHash } from "../lib/repo.mjs";
import { claimSession } from "../lib/sessions.mjs";
import { hasAllNavigatorHooks, readSettingsFile } from "../lib/settings.mjs";
import { listSnapshots } from "../lib/snapshots.mjs";
import { loadSpec } from "../lib/spec.mjs";
import { INIT_ACTIVE, INIT_PENDING, INIT_UNINSTALLED } from "../lib/state.mjs";
import { compareVersions, runtimeVersion } from "../lib/version.mjs";
import { adoptCommit } from "../lib/workflow-orders.mjs";
import { readStateIfValid, saveState } from "./support.mjs";

/**
 * 寻找可恢复快照时最多查看的快照数.
 * @type {number}
 */
const SNAPSHOT_SEARCH_LIMIT = 50;

/**
 * 执行 enter 或 status 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string | undefined} options.sessionId 调用技能的会话.
 * @param {boolean} options.shouldClaim 是否登记编排会话并自动纳入自己的提交.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 */
export function runEnter({ cwd, sessionId, shouldClaim, now }) {
  const environment = checkEnvironment(cwd);
  const nodeLine = `- 运行环境: Node.js ${environment.nodeVersion}${environment.isNodeSupported ? "" : ", 版本过低, 需要 22 或更高版本"}`;
  if (environment.repositoryRoot === undefined) {
    return [
      "- 版本控制: 当前目录不是 Git 仓库",
      nodeLine,
      '- 下一动作: 回复 "初始设置", 使用第 2 组选项, 提示先运行 /waypoint:repo-init',
    ];
  }
  const projectRoot = environment.repositoryRoot;
  const state = readStateIfValid(projectRoot);
  if (state === undefined && existsSync(navigatorPath(projectRoot, "state"))) {
    return [
      "- 初始标记: 状态文件损坏",
      nodeLine,
      `- 下一动作: 回复 "运行受阻", 说明状态文件损坏; 用户同意后运行 snapshots 查看快照, 再运行 restore <快照>`,
    ];
  }
  const isHookInstalled = hasAllNavigatorHooks(
    readSettingsFile(projectRoot, PROJECT_SETTINGS_FILE),
  );
  const lines = [
    `- 版本控制: Git 仓库, 已跟踪 ${countTrackedFiles(projectRoot)} 个文件`,
    nodeLine,
    `- 初始标记: ${describeInit(state)}`,
    `- 防护配置: ${isHookInstalled ? "已安装" : "未安装"}`,
  ];
  const blocker = findBlocker({
    state,
    isHookInstalled,
    isNodeSupported: environment.isNodeSupported,
    projectRoot,
  });
  if (blocker !== undefined) {
    return [...lines, `- 下一动作: ${blocker}`];
  }
  return [
    ...lines,
    ...describeProgress({ projectRoot, state, sessionId, shouldClaim, now }),
  ];
}

/**
 * 对账, 按需登记会话与纳入自己的提交, 然后描述记录情况与下一动作.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} options.state 进入前的状态.
 * @param {string | undefined} options.sessionId 调用技能的会话.
 * @param {boolean} options.shouldClaim 是否写入状态.
 * @param {string} options.now 当前时间.
 * @returns {string[]} 输出各行.
 */
function describeProgress({ projectRoot, state, sessionId, shouldClaim, now }) {
  const spec = loadSpec();
  const reconciliation = reconcile(projectRoot, state);
  const isAnomaly = Object.hasOwn(ANOMALY_GUIDES, reconciliation.kind);
  const isNewSession =
    sessionId !== undefined && state.session?.id !== sessionId;
  const current = shouldClaim
    ? persistEntry({
        context: { projectRoot, state, spec },
        reconciliation,
        sessionId,
        isAnomaly,
        now,
      })
    : state;
  const order = current.order;
  const hasReceipt =
    order !== null &&
    existsSync(path.join(projectRoot, orderFilePath(order.folder, "receipt")));
  const restoreTarget = isAnomaly
    ? findRestoreTarget(projectRoot, reconciliation)
    : undefined;
  const isAdopted = shouldClaim && reconciliation.kind === "own";
  return [
    `- 会话登记: ${describeSession(current, sessionId)}`,
    "",
    ...renderProgressSection(current, spec),
    "",
    `- 最后动作: ${state.lastAction}`,
    `- 记录时间: ${state.updatedAt}`,
    `- 对账结果: ${RECONCILE_LABELS[reconciliation.kind]}${isAdopted ? ", 已自动纳入" : ""}`,
    `- 记录提交: ${shortHash(reconciliation.recorded)}`,
    `- 当前提交: ${shortHash(reconciliation.head)}`,
    `- 差异提交: ${reconciliation.commits.map(shortHash).join(", ") || "无"}`,
    ...(reconciliation.files.length === 0
      ? []
      : [`- 改动文件: ${reconciliation.files.join(", ")}`]),
    ...(isAnomaly ? [`- 可用快照: ${shortHash(restoreTarget)}`] : []),
    ...(order === null
      ? []
      : [
          `- 工单状态: ${order.id} ${order.status}, 回执${hasReceipt ? "已写入" : "未写入"}`,
        ]),
    `- 下一动作: ${nextAction({
      state: current,
      reconciliation,
      hasReceipt,
      isNewSession: shouldClaim && isNewSession,
      restoreTarget,
    })}`,
  ];
}

/**
 * 写入进入时的状态变化: 纳入自己的提交, 标记或清除对账异常, 登记编排会话.
 * 对账异常时不拍快照, 以免新快照掩盖异常.
 *
 * @param {object} options 参数.
 * @param {import("./support.mjs").ProjectContext} options.context 项目上下文.
 * @param {import("../lib/reconcile.mjs").ReconcileResult} options.reconciliation 对账结果.
 * @param {string | undefined} options.sessionId 调用技能的会话.
 * @param {boolean} options.isAnomaly 对账是否异常.
 * @param {string} options.now 当前时间.
 * @returns {import("../lib/state.mjs").NavigatorState} 写入后的状态; 没有变化时为原状态.
 */
function persistEntry({ context, reconciliation, sessionId, isAnomaly, now }) {
  const { state } = context;
  const adopted =
    reconciliation.kind === "own" && reconciliation.head !== undefined
      ? adoptCommit(
          state,
          reconciliation.head,
          `纳入提交 ${shortHash(reconciliation.head)}`,
        )
      : state;
  const anomaly = isAnomaly ? reconciliation.kind : undefined;
  const flagged =
    adopted.pendingAnomaly === anomaly
      ? adopted
      : { ...adopted, pendingAnomaly: anomaly };
  const claimed =
    sessionId === undefined ? flagged : claimSession(flagged, sessionId, now);
  return claimed === state
    ? state
    : saveState(context, claimed, now, { shouldSnapshot: !isAnomaly });
}

/**
 * 找出 "回退记录" 时建议恢复的提交: 回退与分叉时优先用当前提交中入库的记录,
 * 其次用当时 HEAD 相同的最近快照; 记录被改动时用最近的快照.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/reconcile.mjs").ReconcileResult} reconciliation 对账结果.
 * @returns {string | undefined} 提交; 没有合适来源时为 undefined.
 */
function findRestoreTarget(projectRoot, reconciliation) {
  const snapshots = listSnapshots(projectRoot, SNAPSHOT_SEARCH_LIMIT);
  if (reconciliation.kind === "mismatch") {
    return snapshots[0]?.commit;
  }
  const head = reconciliation.head;
  if (head === undefined) {
    return undefined;
  }
  if (readGitBlob(projectRoot, `${head}:${STATE_FILE}`) !== undefined) {
    return head;
  }
  return snapshots.find((entry) => entry.head === head)?.commit;
}

/**
 * 描述编排会话的登记情况. 调用方没有提供会话编号时 (例如在命令行中运行
 * status), 无法判断是不是本会话, 只报告是否已有登记.
 *
 * @param {import("../lib/state.mjs").NavigatorState} state 状态.
 * @param {string | undefined} sessionId 调用方的会话编号.
 * @returns {string} 描述.
 */
function describeSession(state, sessionId) {
  if (state.session?.id === undefined) {
    return "尚无编排会话";
  }
  if (sessionId === undefined) {
    return "已有编排会话登记";
  }
  return state.session.id === sessionId
    ? "本会话是编排会话"
    : "本会话不是编排会话";
}

/**
 * 描述初始化情况.
 *
 * @param {import("../lib/state.mjs").NavigatorState | undefined} state 状态.
 * @returns {string} 描述.
 */
function describeInit(state) {
  if (state === undefined) {
    return "未找到";
  }
  switch (state.init.status) {
    case INIT_ACTIVE:
      return `已初始化, 版本 ${state.skillVersion}`;
    case INIT_PENDING:
      return "已写入配置, 自检未完成";
    case INIT_UNINSTALLED:
      return "已卸载";
    default:
      return `未知状态 ${state.init.status}`;
  }
}

/**
 * 找出阻止进入编排的问题, 并给出下一动作.
 *
 * @param {object} options 判断参数.
 * @param {import("../lib/state.mjs").NavigatorState | undefined} options.state 状态.
 * @param {boolean} options.isHookInstalled hook 是否已全部安装.
 * @param {boolean} options.isNodeSupported Node.js 版本是否满足要求.
 * @param {string} options.projectRoot 项目根目录.
 * @returns {string | undefined} 下一动作; 没有问题时为 undefined.
 */
function findBlocker({ state, isHookInstalled, isNodeSupported, projectRoot }) {
  if (!isNodeSupported) {
    return '回复 "初始设置", 使用第 2 组选项, 提示先安装 Node.js 22 或更高版本';
  }
  if (state === undefined || state.init.status === INIT_UNINSTALLED) {
    return '回复 "初始设置", 使用第 1 组选项';
  }
  if (!isHookInstalled) {
    return '初始化不完整: 回复 "初始设置", 使用第 1 组选项, 用户选 A 后运行 init 修复';
  }
  if (state.init.status === INIT_PENDING) {
    return `完成自检: 用 Write 工具写入 ${path.join(projectRoot, PROBE_FILE)} (预期被拒绝), 再运行 node ${PROJECT_COMMAND_PATH} init --verify`;
  }
  if (compareVersions(state.skillVersion, runtimeVersion()) < 0) {
    return `项目中的运行脚本较旧 (${state.skillVersion}), 回复 "初始设置", 使用第 1 组选项, 用户选 A 后运行 init 升级`;
  }
  return undefined;
}
