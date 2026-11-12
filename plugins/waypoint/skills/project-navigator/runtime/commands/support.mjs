/**
 * @file 命令共用的步骤: 打开项目, 保存状态 (写入并生成路线视图), 读取草稿,
 * 写出提交步骤.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomically } from "../lib/atomic-file.mjs";
import { COMMIT_SKILL } from "../lib/guard.mjs";
import {
  COMMAND_NAME,
  COMMITTED_PATHSPECS,
  DRAFTS_DIRECTORY,
  ENGINEERING_RULES_FILE,
  NAVIGATOR_DIRECTORY,
  PROJECT_SETTINGS_FILE,
  ROADMAP_FILE,
  STATE_FILE,
  isUnderDirectory,
  projectRelativePath,
} from "../lib/paths.mjs";
import { findRepositoryRoot, listUncommittedPaths } from "../lib/repo.mjs";
import { renderRoadmap } from "../lib/roadmap-view.mjs";
import {
  INIT_ACTIVE,
  isCurrentState,
  readRawState,
  writeState,
} from "../lib/state.mjs";
import { runtimeVersion } from "../lib/version.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";

/**
 * 只提交技能产物时, 交给提交技能的参数.
 * @type {string}
 */
const PRODUCTS_COMMIT_ARGUMENT = `提交, 纳入范围: ${NAVIGATOR_DIRECTORY}/ 下的改动, ${PROJECT_SETTINGS_FILE} 与 ${ENGINEERING_RULES_FILE}; 纳入范围之外的改动用文字列出并询问`;

/**
 * @typedef {object} ProjectContext 已初始化项目的上下文.
 * @property {string} projectRoot 项目根目录.
 * @property {import("../lib/state.mjs").NavigatorState} state 当前状态.
 */

/**
 * 打开已初始化的项目.
 *
 * @param {string} cwd 会话工作目录.
 * @returns {ProjectContext} 项目上下文.
 * @throws {WorkflowError} 不在 Git 仓库中, 项目尚未初始化, 或记录由 1.x 写入时.
 */
export function openProject(cwd) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    throw new WorkflowError("当前目录不是 Git 仓库.");
  }
  const raw = readRawState(projectRoot);
  if (raw !== undefined && !isCurrentState(raw)) {
    throw new WorkflowError(
      `${NAVIGATOR_DIRECTORY}/ 中是旧版本的记录, 本版本不读取; 运行 ${COMMAND_NAME} init --archive 归档后重新立项.`,
    );
  }
  if (raw === undefined || raw.init.status !== INIT_ACTIVE) {
    throw new WorkflowError(`项目尚未初始化, 请先运行 ${COMMAND_NAME} init.`);
  }
  return { projectRoot, state: raw };
}

/**
 * 保存新状态: 原子写入, 记下写入时的技能版本, 重新生成路线视图.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} nextState 修改后的状态.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {import("../lib/state.mjs").NavigatorState} 实际写入的状态.
 */
export function saveState(projectRoot, nextState, now) {
  const written = writeState(
    projectRoot,
    { ...nextState, skillVersion: runtimeVersion() },
    now,
  );
  writeFileAtomically(
    path.join(projectRoot, ROADMAP_FILE),
    renderRoadmap(written),
  );
  return written;
}

/**
 * 写出把技能产物提交入库的一步: 状态目录与插件管理的项目配置有未入库的改动时,
 * 请编排会话调用提交技能; 没有改动时不需要这一步.
 *
 * 状态文件与路线视图每条命令都会改写, 默认不算改动; 写下的状态必须入库时
 * (例如确认收尾) 把它们算进去.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} label 这次提交的成果, 例如 "立项完成".
 * @param {{includeState?: boolean, extraPathspecs?: readonly string[]}} [options] 是否把状态文件的改动算进去, 以及额外要提交的范围.
 * @returns {string | undefined} 提交步骤; 没有改动时为 undefined.
 */
export function productsCommitStep(
  projectRoot,
  label,
  { includeState = false, extraPathspecs = [] } = {},
) {
  const changed = listUncommittedPaths(projectRoot, [
    ...COMMITTED_PATHSPECS,
    ...extraPathspecs,
  ]).filter(
    (file) => includeState || (file !== STATE_FILE && file !== ROADMAP_FILE),
  );
  if (changed.length === 0) {
    return undefined;
  }
  const extra =
    extraPathspecs.length === 0 ? "" : `, 以及 ${extraPathspecs.join(", ")}`;
  return `调用 ${COMMIT_SKILL} 提交 "${label}", 参数写 "${PRODUCTS_COMMIT_ARGUMENT}${extra}"`;
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
