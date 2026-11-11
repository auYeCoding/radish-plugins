/**
 * @file stage, step, skip, finish 命令: 进入阶段, 设置步骤, 记录跳过的阶段, 确认收尾.
 *
 * 用法: stage <阶段编号>; step <步骤标识>; skip <阶段编号> --from <草稿>; finish.
 * skip 的草稿格式: {"reason": "跳过原因"}. 跳过必须先得到用户认可.
 * 进入新阶段时, 上一阶段有尚未入库的技能产物, 输出中附上提交这些产物的一步;
 * 确认收尾写下的完成标记也要入库, 所以 finish 总把状态文件算进去.
 */

import { lastStageNumber } from "../lib/spec.mjs";
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
  recordCommitStep,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 确认收尾时提交的成果名.
 * @type {string}
 */
const FINISH_LABEL = "项目收尾";

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
    const saved = saveState(
      context,
      finishProject(context.state, lastStage),
      now,
    );
    return withCommitStep(
      resultLines(saved),
      recordCommitStep(context.projectRoot, FINISH_LABEL, {
        includeState: true,
      }),
    );
  }
  const [argument] = positionals;
  if (argument === undefined) {
    throw new WorkflowError(`${command} 缺少参数.`);
  }
  switch (command) {
    case "stage":
      return advanceStage(context, Number(argument), now);
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
 * 进入新阶段; 上一阶段有尚未入库的技能产物时, 附上提交这些产物的一步.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {number} stage 要进入的阶段编号.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function advanceStage(context, stage, now) {
  const { state, spec, projectRoot } = context;
  const saved = saveState(
    context,
    enterStage(state, stage, lastStageNumber(spec)),
    now,
  );
  const label =
    state.stage === null
      ? "开始阶段"
      : `阶段 ${state.stage} (${spec.stages[state.stage]}) 完成`;
  return withCommitStep(
    resultLines(saved),
    state.stage === null ? undefined : recordCommitStep(projectRoot, label),
  );
}

/**
 * 有提交步骤时, 在输出末尾加上下一动作.
 *
 * @param {string[]} lines 输出各行.
 * @param {string | undefined} commitStep 提交步骤; 不需要提交时为 undefined.
 * @returns {string[]} 输出各行.
 */
function withCommitStep(lines, commitStep) {
  return commitStep === undefined
    ? lines
    : [...lines, `- 下一动作: ${commitStep}, 然后继续`];
}
