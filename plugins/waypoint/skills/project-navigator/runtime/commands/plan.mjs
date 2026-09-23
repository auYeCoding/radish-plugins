/**
 * @file roadmap, milestone, slice 命令: 更新推进路线, 设置里程与切片的状态.
 *
 * 用法:
 * - roadmap --from <草稿>, 草稿格式见 workflow-plan 的 RoadmapDraft
 * - milestone <编号> <pending | active | done>
 * - slice <编号> <pending | active | done>
 */

import { WorkflowError } from "../lib/workflow-error.mjs";
import { applyRoadmap, setProgressStatus } from "../lib/workflow-plan.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 执行推进路线相关命令.
 *
 * @param {object} options 命令参数.
 * @param {"roadmap" | "milestone" | "slice"} options.command 命令名.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法时.
 */
export function runPlan({ command, positionals, values, cwd, now }) {
  const context = openProject(cwd);
  if (command === "roadmap") {
    const draft = readDraftJson(context.projectRoot, values.from);
    return resultLines(
      saveState(context, applyRoadmap(context.state, draft), now),
    );
  }
  const [id, status] = positionals;
  if (id === undefined || status === undefined) {
    throw new WorkflowError(
      `${command} 的用法: ${command} <编号> <pending | active | done>.`,
    );
  }
  return resultLines(
    saveState(
      context,
      setProgressStatus(context.state, command, id, status),
      now,
    ),
  );
}
