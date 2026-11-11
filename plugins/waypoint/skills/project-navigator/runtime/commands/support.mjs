/**
 * @file 命令共用的步骤: 打开项目, 保存状态 (写入并生成视图), 读取草稿, 写出提交步骤.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { COMMIT_SKILL } from "../lib/guard.mjs";
import {
  DRAFTS_DIRECTORY,
  isUnderDirectory,
  projectRelativePath,
} from "../lib/paths.mjs";
import { writePlanViews } from "../lib/render-plan.mjs";
import { findRepositoryRoot, listUncommittedPaths } from "../lib/repo.mjs";
import { loadSpec } from "../lib/spec.mjs";
import { INIT_ACTIVE, readState, writeState } from "../lib/state.mjs";
import {
  COMMITTED_PATHSPECS,
  listUncommittedProducts,
} from "../lib/tracked-paths.mjs";
import { runtimeVersion } from "../lib/version.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";

/**
 * @typedef {object} ProjectContext 已初始化项目的上下文.
 * @property {string} projectRoot 项目根目录.
 * @property {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @property {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 */

/**
 * 打开已初始化的项目.
 *
 * @param {string} cwd 会话工作目录.
 * @returns {ProjectContext} 项目上下文.
 * @throws {WorkflowError} 不在 Git 仓库中, 或项目尚未初始化时.
 */
export function openProject(cwd) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    throw new WorkflowError("当前目录不是 Git 仓库.");
  }
  const state = readState(projectRoot);
  if (state === undefined || state.init.status !== INIT_ACTIVE) {
    throw new WorkflowError("项目尚未初始化, 请先运行 init.");
  }
  return { projectRoot, state, spec: loadSpec() };
}

/**
 * 保存新状态: 原子写入, 记下写入时的技能版本, 重新生成视图文件.
 *
 * @param {ProjectContext} context 项目上下文, 其中的 state 为修改前的状态.
 * @param {import("../lib/state.mjs").NavigatorState} nextState 修改后的状态.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {import("../lib/state.mjs").NavigatorState} 实际写入的状态.
 */
export function saveState(context, nextState, now) {
  const written = writeState(
    context.projectRoot,
    { ...nextState, skillVersion: runtimeVersion() },
    now,
  );
  writePlanViews(context.projectRoot, written, context.spec.format);
  return written;
}

/**
 * 写出把技能产物提交入库的一步: 状态目录与插件管理的项目配置有未入库的改动时,
 * 请编排会话调用提交技能; 没有改动时不需要这一步.
 *
 * 状态文件每条命令都会改写, 默认不算改动; 写下的状态必须入库时 (例如确认收尾)
 * 把它算进去.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} label 这次提交的成果, 例如 "阶段 1 (立项) 完成".
 * @param {{includeState?: boolean}} [options] 是否把状态文件的改动算进去.
 * @returns {string | undefined} 下一动作中的提交步骤; 没有改动时为 undefined.
 */
export function recordCommitStep(
  projectRoot,
  label,
  { includeState = false } = {},
) {
  const changed = includeState
    ? listUncommittedPaths(projectRoot, COMMITTED_PATHSPECS)
    : listUncommittedProducts(projectRoot);
  return changed.length === 0
    ? undefined
    : `调用 ${COMMIT_SKILL} 提交 "${label}" 的技能产物, 参数写 "提交, 纳入范围: .navigator/ 下的改动, .claude/settings.json 与 .claude/rules/engineering.md; 纳入范围之外的改动用文字列出并询问"`;
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
