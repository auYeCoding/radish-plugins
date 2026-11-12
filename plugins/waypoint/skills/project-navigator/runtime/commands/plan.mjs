/**
 * @file roadmap, milestone 与 finish 命令: 更新路线, 完成里程, 确认收尾.
 *
 * 用法:
 * - roadmap --from <草稿>
 * - milestone done <编号>
 * - finish
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { REQUIREMENTS_FILE } from "../lib/paths.mjs";
import {
  applyRoadmap,
  completeMilestone,
  finishProject,
} from "../lib/roadmap.mjs";
import { STAGES } from "../lib/state.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  openProject,
  productsCommitStep,
  readDraftJson,
  saveState,
} from "./support.mjs";

/**
 * 更新路线的命令名.
 * @type {string}
 */
const ROADMAP_COMMAND = "roadmap";

/**
 * 确认收尾的命令名.
 * @type {string}
 */
const FINISH_COMMAND = "finish";

/**
 * milestone 命令唯一的子命令.
 * @type {string}
 */
const MILESTONE_DONE = "done";

/**
 * 执行 roadmap, milestone 或 finish 命令.
 *
 * @param {import("./handlers.mjs").CommandInvocation} invocation 命令调用.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法或操作不被允许时.
 */
export function runPlan({ command, positionals, values, cwd, now }) {
  const { projectRoot, state } = openProject(cwd);
  if (command === ROADMAP_COMMAND) {
    return updateRoadmap(projectRoot, state, values.from, now);
  }
  if (command === FINISH_COMMAND) {
    const written = saveState(projectRoot, finishProject(state), now);
    return withCommit(projectRoot, written, "项目收尾", true);
  }
  const [subcommand, id] = positionals;
  if (subcommand !== MILESTONE_DONE) {
    throw new WorkflowError("milestone 的用法: milestone done <编号>.");
  }
  const written = saveState(projectRoot, completeMilestone(state, id), now);
  return withCommit(projectRoot, written, `里程 ${id} 完成`, true);
}

/**
 * 把路线草稿合并进状态. 需求文件还没有写入时拒绝: 路线要从确认过的需求排出来.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @param {string | undefined} draftPath 草稿路径.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 需求文件不存在, 或草稿不合法时.
 */
function updateRoadmap(projectRoot, state, draftPath, now) {
  if (!existsSync(path.join(projectRoot, REQUIREMENTS_FILE))) {
    throw new WorkflowError(
      `还没有需求文件 ${REQUIREMENTS_FILE}: 先与用户确认需求并写入, 再排路线.`,
    );
  }
  const written = saveState(
    projectRoot,
    applyRoadmap(state, readDraftJson(projectRoot, draftPath)),
    now,
  );
  const lines = written.milestones.flatMap((milestone) => [
    `- 里程 ${milestone.id}: ${milestone.name}`,
    ...milestone.slices.map(
      (slice) =>
        `  - 切片 ${slice.id}: ${slice.name}${slice.skeleton ? " (最小骨架)" : ""}`,
    ),
  ]);
  const isIntakeDone =
    state.stage === STAGES.intake && written.stage === STAGES.slicing;
  return [
    ...lines,
    ...withCommit(
      projectRoot,
      written,
      isIntakeDone ? "立项完成" : "更新路线",
      isIntakeDone,
    ),
  ];
}

/**
 * 输出结果, 有未入库的技能产物时加上提交步骤.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 写入后的状态.
 * @param {string} label 这次提交的成果.
 * @param {boolean} includeState 是否把状态文件的改动算进去.
 * @returns {string[]} 输出各行.
 */
function withCommit(projectRoot, state, label, includeState) {
  const commit = productsCommitStep(projectRoot, label, { includeState });
  return [
    `- 执行结果: ${state.lastAction}`,
    ...(commit === undefined ? [] : [`- 提交步骤: ${commit}`]),
  ];
}
