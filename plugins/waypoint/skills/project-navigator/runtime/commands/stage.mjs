/**
 * @file stage, step, skip 命令: 进入阶段, 设置步骤, 记录跳过的阶段.
 *
 * 用法: stage <阶段编号>; step <步骤标识>; skip <阶段编号> --from <草稿>.
 * skip 的草稿格式: {"reason": "跳过原因"}. 跳过必须先得到用户认可.
 */

import { lastStageNumber } from "../lib/spec.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { enterStage, setStep, skipStage } from "../lib/workflow-plan.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 执行阶段相关命令.
 *
 * @param {object} options 命令参数.
 * @param {"stage" | "step" | "skip"} options.command 命令名.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法时.
 */
export function runStage({ command, positionals, values, cwd, now }) {
  const context = openProject(cwd);
  const lastStage = lastStageNumber(context.spec);
  const [argument] = positionals;
  if (argument === undefined) {
    throw new WorkflowError(`${command} 缺少参数.`);
  }
  switch (command) {
    case "stage":
      return resultLines(
        saveState(
          context,
          enterStage(context.state, Number(argument), lastStage),
          now,
        ),
      );
    case "step":
      return resultLines(
        saveState(context, setStep(context.state, argument), now),
      );
    case "skip": {
      const draft = readDraftJson(context.projectRoot, values.from);
      return resultLines(
        saveState(
          context,
          skipStage(
            context.state,
            Number(argument),
            String(draft.reason ?? ""),
            { lastStage, now },
          ),
          now,
        ),
      );
    }
    default:
      throw new WorkflowError(`未知命令 ${command}.`);
  }
}
