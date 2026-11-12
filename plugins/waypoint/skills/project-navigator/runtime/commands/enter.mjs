/**
 * @file enter 与 status 命令: 检查环境与初始化情况, 输出当前状态与下一动作.
 *
 * enter 由技能加载时的 `!` 命令调用, 输出会原样注入技能内容, 因此必须始终以
 * 退出码 0 结束. enter 的输出带本项目的编排标记: 技能内容记在会话转录中, hook
 * 据此认出编排会话, 不需要登记. status 只查询, 不输出标记, 不写项目文件;
 * 两者都做状态自检, status 另外记下给出的下一动作, 用来发现技能自身的问题
 * (见 lib/diagnostics.mjs), 这些记录在本机的运行期登记目录中.
 */

import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import {
  EVENT_KINDS,
  EVENT_LABELS,
  REPORT_STEP,
  recordEvent,
  trackGuidance,
  unreportedEvents,
} from "../lib/diagnostics.mjs";
import { checkEnvironment } from "../lib/environment.mjs";
import { REPORT_OPTIONS, nextAction, replyStep } from "../lib/guidance.mjs";
import { digestOrderFile, readApprovalStatus } from "../lib/order-approval.mjs";
import { orchestratorMarker } from "../lib/orchestrator-marker.mjs";
import {
  LEGACY_BIN_DIRECTORY,
  NAVIGATOR_IGNORE_FILE,
  PROJECT_LOCAL_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
  navigatorPath,
  registryDirectory,
} from "../lib/paths.mjs";
import { readReceiptStatus } from "../lib/receipt-record.mjs";
import { progressLine } from "../lib/render.mjs";
import {
  countTrackedFiles,
  findIgnoredPaths,
  listUncommittedPaths,
} from "../lib/repo.mjs";
import {
  NAVIGATOR_PERMISSION_RULES,
  hasLegacyHooks,
  readSettingsFile,
} from "../lib/settings.mjs";
import { lastStageNumber, loadSpec } from "../lib/spec.mjs";
import {
  INIT_ACTIVE,
  INIT_UNINSTALLED,
  readStateIfValid,
} from "../lib/state.mjs";
import {
  COMMITTED_PATHSPECS,
  requiredTrackedPaths,
  summarizeIgnoredPaths,
} from "../lib/tracked-paths.mjs";
import { checkStateConsistency } from "../lib/state-checks.mjs";
import { describeModels } from "../lib/subagent-models.mjs";
import { ISSUED_ORDER_STATUS } from "../lib/workflow-orders.mjs";
import { isProjectFinished } from "../lib/workflow-plan.mjs";

/**
 * "初始设置" 中请用户确认初始化或升级的选项组.
 * @type {number}
 */
const SETUP_OPTION = 1;

/**
 * "初始设置" 中说明环境不满足, 无法初始化的选项组.
 * @type {number}
 */
const SETUP_BLOCKED_OPTION = 2;

/**
 * 1.0.0 之前登记编排会话的文件名. 升级之前旧版 hook 仍会运行, 它按这个文件
 * 判断编排会话并按白名单拦下命令; 进入时删掉, 旧 hook 就不再拦下升级命令.
 * @type {string}
 */
const LEGACY_ORCHESTRATOR_FILE = "orchestrator.json";

/**
 * 执行 enter 或 status 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {boolean} options.isEntry 是否为调用技能时的进入.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 */
export function runEnter({ cwd, isEntry, now }) {
  const spec = loadSpec();
  const environment = checkEnvironment(cwd);
  const nodeLine = `- 运行环境: Node.js ${environment.nodeVersion}${environment.isNodeSupported ? "" : ", 版本过低, 需要 22 或更高版本"}`;
  if (environment.repositoryRoot === undefined) {
    return [
      "- 版本控制: 当前目录不是 Git 仓库",
      nodeLine,
      `- 下一动作: ${replyStep(spec, "初始设置", SETUP_BLOCKED_OPTION)}, 提示先运行 /waypoint:repo-init`,
    ];
  }
  const projectRoot = environment.repositoryRoot;
  const markerLines = isEntry
    ? [`- 编排标记: ${orchestratorMarker(projectRoot)}`]
    : [];
  const state = readStateIfValid(projectRoot);
  if (state === undefined && existsSync(navigatorPath(projectRoot, "state"))) {
    return [
      ...markerLines,
      "- 初始标记: 状态文件损坏",
      nodeLine,
      `- 下一动作: ${replyStep(spec, "运行受阻")}, 说明状态文件不是合法的 JSON; 请用户用 git 恢复 .navigator/state.json 后重新调用技能`,
    ];
  }
  const isLegacy = isLegacyInstall(projectRoot);
  if (isEntry && isLegacy) {
    rmSync(
      path.join(registryDirectory(projectRoot), LEGACY_ORCHESTRATOR_FILE),
      {
        force: true,
      },
    );
  }
  const lines = [
    ...markerLines,
    `- 版本控制: Git 仓库, 已跟踪 ${countTrackedFiles(projectRoot)} 个文件`,
    nodeLine,
    `- 初始标记: ${describeInit(state, isLegacy)}`,
    `- 放行规则: ${hasPermissionRules(projectRoot) ? "已写入" : "未写入"}`,
  ];
  const blocker = findBlocker({
    state,
    isLegacy,
    isNodeSupported: environment.isNodeSupported,
    projectRoot,
    spec,
  });
  if (blocker !== undefined || state === undefined) {
    return [...lines, `- 下一动作: ${blocker ?? ""}`];
  }
  return [
    ...lines,
    ...describeProgress({ projectRoot, state, isEntry, spec, now }),
  ];
}

/**
 * 描述记录情况与下一动作.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} options.state 当前状态.
 * @param {boolean} options.isEntry 是否为调用技能时的进入.
 * @param {import("../lib/spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 */
function describeProgress({ projectRoot, state, isEntry, spec, now }) {
  const order = state.order;
  const receiptStatus =
    order === null ? undefined : readReceiptStatus(projectRoot, order);
  const uncommitted = listUncommittedPaths(projectRoot, COMMITTED_PATHSPECS);
  const inconsistencies = checkStateConsistency({ state, projectRoot, spec });
  for (const message of inconsistencies) {
    recordEvent(projectRoot, {
      kind: EVENT_KINDS.invalidState,
      source: "status",
      message,
      stack: [],
      at: now,
    });
  }
  const action =
    inconsistencies.length > 0
      ? `状态不自洽, 不能照常继续: ${inconsistencies.join(" ")} ${REPORT_STEP}, 使用第 ${REPORT_OPTIONS.blocking} 组选项`
      : nextAction({
          state,
          receiptStatus,
          orderApproval:
            order === null ? undefined : readApprovalStatus(projectRoot, order),
          isOrderUnchanged:
            order === null
              ? undefined
              : order.issuedDigest === digestOrderFile(projectRoot, order),
          hasUncommittedRecords:
            isProjectFinished(state, lastStageNumber(spec)) &&
            uncommitted.length > 0,
          isEntry,
          spec,
        });
  if (!isEntry) {
    trackGuidance(projectRoot, {
      action,
      revision: state.revision,
      isWaiting:
        order?.status === ISSUED_ORDER_STATUS && receiptStatus === undefined,
      now,
    });
  }
  const pending = unreportedEvents(projectRoot);
  return [
    "",
    `- 当前进展: ${progressLine(state, spec)}`,
    `- 最后动作: ${state.lastAction}`,
    `- 记录时间: ${state.updatedAt}`,
    ...(order === null
      ? []
      : [
          `- 工单状态: ${order.id} ${order.status}, 回执${describeReceipt(receiptStatus)}`,
        ]),
    `- 工作区域: ${uncommitted.length === 0 ? "技能产物都已入库" : `${uncommitted.length} 个技能产物未入库`}`,
    `- 子代理模型: ${describeModels(state.models)}`,
    ...(pending.length === 0
      ? []
      : [
          `- 技能异常: 脚本记录到 ${pending.length} 条还没有上报的异常 (${[...new Set(pending.map((event) => EVENT_LABELS[event.kind] ?? event.kind))].join(", ")}). ${REPORT_STEP}`,
        ]),
    `- 下一动作: ${action}`,
  ];
}

/**
 * 描述回执的情况.
 *
 * @param {string | undefined} receiptStatus 回执中的执行状态; 回执不存在时为 undefined.
 * @returns {string} 描述.
 */
function describeReceipt(receiptStatus) {
  if (receiptStatus === undefined) {
    return "未写入";
  }
  return receiptStatus === "" ? "已写入" : `已写入, 执行状态 ${receiptStatus}`;
}

/**
 * 判断项目是否由 1.0.0 之前的版本初始化: 项目配置中还有项目级 hook, 或状态目录中
 * 还有运行脚本副本.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {boolean} 是旧版本的安装时返回 true.
 */
function isLegacyInstall(projectRoot) {
  return (
    existsSync(path.join(projectRoot, LEGACY_BIN_DIRECTORY)) ||
    hasLegacyHooks(readSettingsFile(projectRoot, PROJECT_SETTINGS_FILE))
  );
}

/**
 * 判断本机配置中是否已有本技能的全部放行规则.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {boolean} 全部写入时返回 true.
 */
function hasPermissionRules(projectRoot) {
  const allow =
    readSettingsFile(projectRoot, PROJECT_LOCAL_SETTINGS_FILE).permissions
      ?.allow ?? [];
  return NAVIGATOR_PERMISSION_RULES.every((rule) => allow.includes(rule));
}

/**
 * 描述初始化情况.
 *
 * @param {import("../lib/state.mjs").NavigatorState | undefined} state 状态.
 * @param {boolean} isLegacy 是否为 1.0.0 之前的安装.
 * @returns {string} 描述.
 */
function describeInit(state, isLegacy) {
  if (state === undefined) {
    return "未找到";
  }
  if (state.init.status === INIT_UNINSTALLED) {
    return "已卸载";
  }
  return isLegacy
    ? `由旧版本 ${state.skillVersion} 初始化, 需要升级`
    : `已初始化, 版本 ${state.skillVersion}`;
}

/**
 * 找出阻止进入编排的问题, 并给出下一动作. 必须入库的路径被忽略规则漏掉时也要
 * 停下: 否则新写的记录会悄悄漏提交.
 *
 * @param {object} options 判断参数.
 * @param {import("../lib/state.mjs").NavigatorState | undefined} options.state 状态.
 * @param {boolean} options.isLegacy 是否为 1.0.0 之前的安装.
 * @param {boolean} options.isNodeSupported Node.js 版本是否满足要求.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("../lib/spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string | undefined} 下一动作; 没有问题时为 undefined.
 */
function findBlocker({ state, isLegacy, isNodeSupported, projectRoot, spec }) {
  if (!isNodeSupported) {
    return `${replyStep(spec, "初始设置", SETUP_BLOCKED_OPTION)}, 提示先安装 Node.js 22 或更高版本`;
  }
  const setup = `${replyStep(spec, "初始设置", SETUP_OPTION)}, 用户选 A 后运行 init`;
  if (state === undefined || state.init.status !== INIT_ACTIVE) {
    return setup;
  }
  if (isLegacy) {
    return `项目由 1.0.0 之前的版本初始化, 需要升级 (移除项目中的旧 hook 与脚本副本, 记录保留): ${setup}`;
  }
  const ignored = findIgnoredPaths(projectRoot, requiredTrackedPaths(spec));
  if (ignored.length > 0) {
    return `${replyStep(spec, "运行受阻")}, 说明编排记录或项目配置会被 Git 忽略, 无法入库: ${summarizeIgnoredPaths(ignored).join("; ")}. 用户修改这些规则后重新调用技能; 规则在 ${NAVIGATOR_IGNORE_FILE} 中时, 运行 init 即可恢复`;
  }
  return undefined;
}
