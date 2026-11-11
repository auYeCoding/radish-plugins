/**
 * @file exec-brief, review-brief, research-brief 命令: 输出派子代理时使用的固定提示词.
 *
 * 提示词由脚本生成, 编排会话原样使用, 不在其中加入倾向性说明.
 */

import {
  RESEARCH_FRAME,
  buildExecutorBrief,
  buildReviewBrief,
} from "../lib/briefs.mjs";
import { orderCheckCommands } from "../lib/code-checks.mjs";
import { criteriaTableSpec } from "../lib/review-record.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { ISSUED_ORDER_STATUS } from "../lib/workflow-orders.mjs";
import { openProject } from "./support.mjs";

/**
 * 执行提示词命令.
 *
 * @param {object} options 命令参数.
 * @param {"exec-brief" | "review-brief" | "research-brief"} options.command 命令名.
 * @param {string} options.cwd 会话工作目录.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 没有当前工单, 工单不在需要的状态, 或命令未知时.
 */
export function runBrief({ command, cwd }) {
  const context = openProject(cwd);
  if (command === "research-brief") {
    return RESEARCH_FRAME.split("\n");
  }
  const order = context.state.order;
  if (order === null) {
    throw new WorkflowError("当前没有工单.");
  }
  switch (command) {
    case "exec-brief":
      if (order.status !== ISSUED_ORDER_STATUS) {
        throw new WorkflowError(
          `工单 ${order.id} 处于 ${order.status}, 发布 (order set issued) 之后才能派执行子代理.`,
        );
      }
      return buildExecutorBrief({
        projectRoot: context.projectRoot,
        order,
      }).split("\n");
    case "review-brief":
      return buildReviewBrief({
        projectRoot: context.projectRoot,
        order,
        checkCommands: orderCheckCommands(context.state),
        criteriaTable: criteriaTableSpec(context.spec),
      }).split("\n");
    default:
      throw new WorkflowError(`未知命令 ${command}.`);
  }
}
