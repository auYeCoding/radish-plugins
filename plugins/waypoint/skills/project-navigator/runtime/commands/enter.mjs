/**
 * @file enter 与 status 命令: 检查环境与初始化情况, 输出当前位置与下一动作.
 *
 * enter 由技能加载时的 `!` 命令调用, 输出会原样注入技能内容, 因此必须始终以
 * 退出码 0 结束. enter 的输出带本项目的编排标记: 技能内容记在会话转录中, hook
 * 据此认出编排会话, 不需要登记. status 只查询, 不输出标记, 不写任何文件.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { checkEnvironment } from "../lib/environment.mjs";
import {
  command,
  nextAction,
  progressLine,
  readFacts,
} from "../lib/guidance.mjs";
import { orchestratorMarker } from "../lib/orchestrator-marker.mjs";
import {
  ARCHIVE_DIRECTORY,
  COMMITTED_PATHSPECS,
  NAVIGATOR_DIRECTORY,
  NAVIGATOR_IGNORE_FILE,
  PROJECT_LOCAL_SETTINGS_FILE,
  REQUIRED_TRACKED_PATHS,
  STATE_FILE,
} from "../lib/paths.mjs";
import {
  findIgnoredPaths,
  listTrackedFiles,
  listUncommittedPaths,
  summarizeIgnoredPaths,
} from "../lib/repo.mjs";
import { hasNavigatorPermissions, readSettingsFile } from "../lib/settings.mjs";
import {
  INIT_ACTIVE,
  ORGANIZATION_LABELS,
  VERIFICATION_LABELS,
  isCurrentState,
  readRawState,
} from "../lib/state.mjs";

/**
 * 执行 enter 或 status 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {boolean} options.isEntry 是否为调用技能时的进入.
 * @returns {string[]} 输出各行.
 */
export function runEnter({ cwd, isEntry }) {
  const environment = checkEnvironment(cwd);
  const nodeLine = `- 运行环境: Node.js ${environment.nodeVersion}${environment.isNodeSupported ? "" : ", 版本过低, 需要 22 或更高版本"}`;
  if (environment.repositoryRoot === undefined) {
    return [
      "- 版本控制: 当前目录不是 Git 仓库",
      nodeLine,
      "- 下一动作: 告诉用户本技能需要 Git 仓库, 请先运行 /waypoint:repo-init",
    ];
  }
  const projectRoot = environment.repositoryRoot;
  const raw = readRawState(projectRoot);
  const lines = [
    ...(isEntry ? [`- 编排标记: ${orchestratorMarker(projectRoot)}`] : []),
    `- 版本控制: Git 仓库, 已跟踪 ${listTrackedFiles(projectRoot).length} 个文件`,
    nodeLine,
  ];
  if (!environment.isNodeSupported) {
    return [...lines, "- 下一动作: 告诉用户先安装 Node.js 22 或更高版本"];
  }
  const blocker = findBlocker(projectRoot, raw);
  if (blocker !== undefined) {
    return [...lines, ...blocker];
  }
  return [
    ...lines,
    ...describeProgress(
      projectRoot,
      /** @type {import("../lib/state.mjs").NavigatorState} */ (raw),
    ),
  ];
}

/**
 * 找出阻止进入编排的情况: 没有初始化, 旧版本的记录, 状态文件损坏, 或必须入库的
 * 路径被忽略规则漏掉.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {Record<string, any> | undefined} raw 读取到的状态文件内容.
 * @returns {string[] | undefined} 输出各行; 可以照常进入时为 undefined.
 */
function findBlocker(projectRoot, raw) {
  const hasStateFile = existsSync(path.join(projectRoot, STATE_FILE));
  if (hasStateFile && raw === undefined) {
    return [
      "- 初始标记: 状态文件损坏",
      `- 下一动作: 告诉用户 ${STATE_FILE} 不是合法的 JSON, 请用 git 恢复后重新调用技能`,
    ];
  }
  if (raw !== undefined && !isCurrentState(raw)) {
    return [
      `- 初始标记: ${NAVIGATOR_DIRECTORY}/ 由旧版本 ${raw.skillVersion ?? "未知"} 写入`,
      `- 下一动作: 告诉用户本版本不读取旧记录, 也不迁移; 用户同意后运行 ${command("init --archive")}, 把 ${NAVIGATOR_DIRECTORY}/ 改名为 ${ARCHIVE_DIRECTORY}/ (只改名, 不删除), 然后重新立项. 用户不同意时结束, 不做任何修改`,
    ];
  }
  if (raw === undefined || raw.init.status !== INIT_ACTIVE) {
    return [
      `- 初始标记: ${raw === undefined ? "未找到" : "已卸载"}`,
      `- 下一动作: 询问用户是否在本项目初始化 (创建 ${NAVIGATOR_DIRECTORY}/, 在项目配置中加入插件命令的放行规则, 保留已有配置); 同意后运行 ${command("init")}, 不同意时结束. 本次调用参数是 init 时, 用户已经同意, 不再询问, 直接运行`,
    ];
  }
  const ignored = findIgnoredPaths(projectRoot, REQUIRED_TRACKED_PATHS);
  if (ignored.length > 0) {
    return [
      `- 初始标记: 已初始化, 版本 ${raw.skillVersion}`,
      `- 下一动作: 告诉用户编排记录或项目配置会被 Git 忽略, 无法入库: ${summarizeIgnoredPaths(ignored).join("; ")}. 用户修改这些规则后重新调用技能; 规则在 ${NAVIGATOR_IGNORE_FILE} 中时, 运行 ${command("init")} 即可恢复`,
    ];
  }
  return undefined;
}

/**
 * 描述位置, 项目设置与下一动作.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @returns {string[]} 输出各行.
 */
function describeProgress(projectRoot, state) {
  const uncommitted = listUncommittedPaths(projectRoot, COMMITTED_PATHSPECS);
  const hasPermissions = hasNavigatorPermissions(
    readSettingsFile(projectRoot, PROJECT_LOCAL_SETTINGS_FILE),
  );
  return [
    `- 初始标记: 已初始化, 版本 ${state.skillVersion}`,
    `- 放行规则: ${hasPermissions ? "已写入" : `未写入, 运行 ${command("init")} 补上`}`,
    "",
    `- 当前进展: ${progressLine(state)}`,
    `- 项目设置: ${describeSettings(state.project)}`,
    `- 最后动作: ${state.lastAction} (${state.updatedAt})`,
    `- 工作区域: ${uncommitted.length === 0 ? "技能产物都已入库" : `${uncommitted.length} 个技能产物未入库`}`,
    `- 下一动作: ${nextAction(state, readFacts(projectRoot, state))}`,
  ];
}

/**
 * 描述项目设置.
 *
 * @param {import("../lib/state.mjs").ProjectSettings} project 项目设置.
 * @returns {string} 一行描述.
 */
function describeSettings(project) {
  if (project.organization === null || project.verification === null) {
    return "未登记";
  }
  const { mode, commands } = project.verification;
  return `${ORGANIZATION_LABELS[project.organization]}; 验证方式为${VERIFICATION_LABELS[mode]}${commands.length === 0 ? "" : ` (${commands.join("; ")})`}`;
}
