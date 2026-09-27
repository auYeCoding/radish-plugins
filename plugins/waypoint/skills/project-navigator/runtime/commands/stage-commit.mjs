/**
 * @file stagecommit 命令: 处理初始化与阶段完成后的阶段提交.
 *
 * 用法:
 * - stagecommit start: 用户在 "阶段提交" 中选择提交后运行, 进入提交步骤,
 *   守卫随之放行 commit-message 与提交命令.
 * - stagecommit done: 提交完成后运行, 核对记录已全部入库, 把 lastCommit 设为 HEAD.
 * - stagecommit skip: 用户选择暂不提交时运行.
 */

import {
  finishStageCommit,
  skipStageCommit,
  startStageCommit,
} from "../lib/commit-step.mjs";
import { COMMIT_SKILL } from "../lib/guard.mjs";
import { headCommit } from "../lib/repo.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  assertRecordsCommitted,
  openProject,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 提交完成后要运行的命令.
 * @type {string}
 */
const DONE_COMMAND = "stagecommit done";

/**
 * 执行 stagecommit 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 用法不对, 或阶段提交不在对应状态时.
 */
export function runStageCommit({ positionals, cwd, now }) {
  const context = openProject(cwd);
  switch (positionals[0]) {
    case "start":
      return [
        ...resultLines(
          saveState(context, startStageCommit(context.state), now),
        ),
        `- 下一动作: 按用户选择的范围调用 ${COMMIT_SKILL}, 提交完成后运行 ${DONE_COMMAND}`,
      ];
    case "done":
      return finish(context, now);
    case "skip":
      return resultLines(
        saveState(context, skipStageCommit(context.state), now),
      );
    default:
      throw new WorkflowError(
        "stagecommit 的用法: stagecommit start|done|skip.",
      );
  }
}

/**
 * 提交完成: 记录与插件管理的配置必须已全部入库, 然后把 lastCommit 设为 HEAD.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 仓库还没有提交, 或仍有未入库的记录时.
 */
function finish(context, now) {
  const head = headCommit(context.projectRoot);
  if (head === undefined) {
    throw new WorkflowError(
      `仓库还没有任何提交: 先调用 ${COMMIT_SKILL} 完成提交, 再运行 ${DONE_COMMAND}.`,
    );
  }
  assertRecordsCommitted(context.projectRoot, DONE_COMMAND);
  return resultLines(
    saveState(context, finishStageCommit(context.state, head), now),
  );
}
