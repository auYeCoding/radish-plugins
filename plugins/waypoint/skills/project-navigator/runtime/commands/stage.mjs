/**
 * @file stage, step, skip, finish 命令: 进入阶段, 设置步骤, 记录跳过的阶段, 确认收尾.
 *
 * 用法: stage <阶段编号>; step <步骤标识>; skip <阶段编号> --from <草稿>; finish.
 * skip 的草稿格式: {"reason": "跳过原因"}. 跳过必须先得到用户认可.
 * 进入新阶段, 或在最后一个阶段确认收尾时, 当前阶段有尚未入库的技能产物, 就登记
 * 一次阶段提交. 最后一个阶段之后不再推进, 收尾记录只能由 finish 登记的阶段提交入库.
 */

import {
  STAGE_COMMIT_REPLY_TYPE,
  assertNoStageCommit,
  requestStageCommit,
} from "../lib/commit-step.mjs";
import { replyStep } from "../lib/guidance.mjs";
import { lastStageNumber } from "../lib/spec.mjs";
import { listUncommittedProducts } from "../lib/tracked-paths.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  enterStage,
  finishProject,
  setStep,
  skipStage,
} from "../lib/workflow-plan.mjs";
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
 * @param {"stage" | "step" | "skip" | "finish"} options.command 命令名.
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
  if (command === "finish") {
    return saveWithStageCommit(
      context,
      finishProject(context.state, lastStage),
      now,
    );
  }
  const [argument] = positionals;
  if (argument === undefined) {
    throw new WorkflowError(`${command} 缺少参数.`);
  }
  switch (command) {
    case "stage":
      return saveWithStageCommit(
        context,
        enterStage(context.state, Number(argument), lastStage),
        now,
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

/**
 * 保存推进后的状态. 推进之前所在的阶段有尚未入库的技能产物时, 登记一次阶段提交,
 * 下一动作是请用户选择提交范围; 未处理的阶段提交会拦住下一次推进.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文, 其中的状态是推进之前的状态.
 * @param {import("../lib/state.mjs").NavigatorState} advanced 推进后的状态.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 有未处理的阶段提交时.
 */
function saveWithStageCommit(context, advanced, now) {
  const { state, spec, projectRoot } = context;
  const commitStep = replyStep(spec, STAGE_COMMIT_REPLY_TYPE);
  assertNoStageCommit(state, commitStep);
  const hasProducts =
    state.stage !== null && listUncommittedProducts(projectRoot).length > 0;
  const saved = saveState(
    context,
    hasProducts
      ? requestStageCommit(
          advanced,
          `阶段 ${state.stage} (${spec.stages[state.stage]}) 完成`,
        )
      : advanced,
    now,
  );
  return [
    ...resultLines(saved),
    ...(hasProducts ? [`- 下一动作: ${commitStep}`] : []),
  ];
}
