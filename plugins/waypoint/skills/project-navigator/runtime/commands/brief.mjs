/**
 * @file review-brief, research-brief 命令: 输出派子代理时使用的固定提示词.
 *
 * 守卫要求验收子代理的提示词与 review-brief 的输出逐字一致, 调研子代理的提示词
 * 以 research-brief 的输出开头, 防止编排会话在提示词中加入倾向性说明.
 */

import { RESEARCH_FRAME, buildReviewBrief } from "../lib/briefs.mjs";
import { orderTestCommands } from "../lib/code-checks.mjs";
import { criteriaTableSpec } from "../lib/review-record.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { openProject } from "./support.mjs";

/**
 * 执行提示词命令.
 *
 * @param {object} options 命令参数.
 * @param {"review-brief" | "research-brief"} options.command 命令名.
 * @param {string} options.cwd 会话工作目录.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 没有当前工单或命令未知时.
 */
export function runBrief({ command, cwd }) {
  const context = openProject(cwd);
  switch (command) {
    case "research-brief":
      return RESEARCH_FRAME.split("\n");
    case "review-brief": {
      const order = context.state.order;
      if (order === null) {
        throw new WorkflowError("当前没有工单.");
      }
      return buildReviewBrief({
        projectRoot: context.projectRoot,
        order,
        testCommands: orderTestCommands(context.state),
        criteriaTable: criteriaTableSpec(context.spec),
      }).split("\n");
    }
    default:
      throw new WorkflowError(`未知命令 ${command}.`);
  }
}
