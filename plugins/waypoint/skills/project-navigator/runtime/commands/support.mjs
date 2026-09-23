/**
 * @file 命令共用的步骤: 打开项目, 保存状态 (写入, 生成视图, 拍摄快照), 读取草稿.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { ANOMALY_GUIDES, replyStep } from "../lib/guidance.mjs";
import {
  DRAFTS_DIRECTORY,
  isUnderDirectory,
  projectRelativePath,
} from "../lib/paths.mjs";
import { RECONCILE_LABELS } from "../lib/reconcile.mjs";
import { writePlanViews } from "../lib/render-plan.mjs";
import { findRepositoryRoot, headCommit } from "../lib/repo.mjs";
import { takeSnapshot } from "../lib/snapshots.mjs";
import { loadSpec } from "../lib/spec.mjs";
import { INIT_ACTIVE, readState, writeState } from "../lib/state.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";

/**
 * @typedef {object} ProjectContext 已初始化项目的上下文.
 * @property {string} projectRoot 项目根目录.
 * @property {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @property {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 */

/**
 * 打开已初始化且防护生效的项目. 对账异常尚未处理时, 只有处理异常的命令能打开.
 *
 * @param {string} cwd 会话工作目录.
 * @param {{allowAnomaly?: boolean}} [options] 是否允许在对账异常尚未处理时打开.
 * @returns {ProjectContext} 项目上下文.
 * @throws {WorkflowError} 不在 Git 仓库中, 项目尚未完成初始化, 或对账异常尚未处理时.
 */
export function openProject(cwd, { allowAnomaly = false } = {}) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    throw new WorkflowError("当前目录不是 Git 仓库.");
  }
  const state = readState(projectRoot);
  if (state === undefined || state.init.status !== INIT_ACTIVE) {
    throw new WorkflowError("项目尚未完成初始化, 请先运行 init 并通过自检.");
  }
  const spec = loadSpec();
  if (!allowAnomaly && state.pendingAnomaly !== undefined) {
    throw new WorkflowError(
      `对账异常 "${RECONCILE_LABELS[state.pendingAnomaly] ?? state.pendingAnomaly}" 尚未处理: 先${replyStep(spec, "验收异常", ANOMALY_GUIDES[state.pendingAnomaly]?.optionSet)}, 再按用户的选择运行 restore 或 adopt.`,
    );
  }
  return { projectRoot, state, spec };
}

/**
 * 为恢复记录打开项目: 不要求初始化完成, 状态文件损坏时也能打开,
 * 避免坏状态让恢复命令本身无法运行.
 *
 * @param {string} cwd 会话工作目录.
 * @returns {{projectRoot: string, state: import("../lib/state.mjs").NavigatorState | undefined, spec: import("../lib/spec.mjs").TemplateSpec}} 项目根目录, 可读时的当前状态与模板规格.
 * @throws {WorkflowError} 不在 Git 仓库中时.
 */
export function openProjectForRecovery(cwd) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    throw new WorkflowError("当前目录不是 Git 仓库.");
  }
  return {
    projectRoot,
    state: readStateIfValid(projectRoot),
    spec: loadSpec(),
  };
}

/**
 * 读取状态文件; 文件不存在或不是合法 JSON 时返回 undefined.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {import("../lib/state.mjs").NavigatorState | undefined} 状态.
 * @throws {Error} 读取文件本身失败时.
 */
export function readStateIfValid(projectRoot) {
  try {
    return readState(projectRoot);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 保存新状态: 原子写入, 重新生成视图文件, 拍摄快照.
 *
 * @param {ProjectContext} context 项目上下文, 其中的 state 为修改前的状态.
 * @param {import("../lib/state.mjs").NavigatorState} nextState 修改后的状态.
 * @param {string} now 当前时间, ISO 格式.
 * @param {{shouldSnapshot?: boolean}} [options] 对账发现异常时不拍快照, 以免异常被新快照掩盖.
 * @returns {import("../lib/state.mjs").NavigatorState} 实际写入的状态.
 */
export function saveState(
  context,
  nextState,
  now,
  { shouldSnapshot = true } = {},
) {
  const written = writeState(context.projectRoot, nextState, now);
  writePlanViews(context.projectRoot, written, context.spec.format);
  if (shouldSnapshot) {
    takeSnapshot(context.projectRoot, {
      now,
      head: headCommit(context.projectRoot),
    });
  }
  return written;
}

/**
 * 读取草稿目录中的 JSON 草稿.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string | undefined} draftPath 草稿路径, 相对于项目根目录或绝对路径.
 * @returns {any} 解析后的内容.
 * @throws {WorkflowError} 缺少路径, 路径不在草稿目录中, 文件不存在或不是合法 JSON 时.
 */
export function readDraftJson(projectRoot, draftPath) {
  if (draftPath === undefined) {
    throw new WorkflowError(
      `缺少 --from 参数: 请先用 Write 把内容写进 ${DRAFTS_DIRECTORY}/ 下的 JSON 文件.`,
    );
  }
  const relative = projectRelativePath(projectRoot, draftPath);
  if (relative === undefined || !isUnderDirectory(relative, DRAFTS_DIRECTORY)) {
    throw new WorkflowError(`草稿必须放在 ${DRAFTS_DIRECTORY}/ 下.`);
  }
  const file = path.join(projectRoot, relative);
  if (!existsSync(file)) {
    throw new WorkflowError(`草稿 ${relative} 不存在.`);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new WorkflowError(
      `草稿 ${relative} 不是合法的 JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 输出状态变化后的简短结果行.
 *
 * @param {import("../lib/state.mjs").NavigatorState} state 写入后的状态.
 * @returns {string[]} 输出各行.
 */
export function resultLines(state) {
  return [`- 执行结果: ${state.lastAction}`];
}
