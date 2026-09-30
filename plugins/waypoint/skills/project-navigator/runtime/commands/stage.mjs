/**
 * @file stage, step, skip, finish 命令: 进入阶段, 设置步骤, 记录跳过的阶段, 确认收尾.
 *
 * 用法: stage <阶段编号>; step <步骤标识>; skip <阶段编号> --from <草稿>; finish.
 * skip 的草稿格式: {"reason": "跳过原因"}. 跳过必须先得到用户认可.
 * 进入新阶段, 或在最后一个阶段确认收尾时, 当前阶段有尚未入库的技能产物, 就登记
 * 一次阶段提交. 最后一个阶段之后不再推进, 收尾记录只能由 finish 登记的阶段提交入库.
 * finish 写下的完成标记之后也没有别的提交能带上, 所以 HEAD 中的状态文件还没有
 * 这个标记时, 即使收尾记录已经入库, finish 同样登记阶段提交.
 *
 * 项目已确认收尾后, 写入的状态同样没有后续提交能带走. 这时再运行 finish: 记录
 * (含状态文件) 有未入库的改动就登记阶段提交, 例如收尾后处理验收异常时写下的状态;
 * 没有改动就什么也不写, 以免工作区留下没有提交途径的改动.
 */

import {
  STAGE_COMMIT_REPLY_TYPE,
  assertNoStageCommit,
  requestStageCommit,
} from "../lib/commit-step.mjs";
import { COMPLETE_REPLY_TYPE, replyStep } from "../lib/guidance.mjs";
import { STATE_FILE } from "../lib/paths.mjs";
import { listUncommittedPaths, readGitBlob } from "../lib/repo.mjs";
import { lastStageNumber } from "../lib/spec.mjs";
import {
  COMMITTED_PATHSPECS,
  listUncommittedProducts,
} from "../lib/tracked-paths.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  enterStage,
  finishProject,
  isProjectFinished,
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
 * 项目收尾之后登记的阶段提交的名称, 也是登记时的最后动作.
 * @type {string}
 */
const FINISHED_RECORDS_LABEL = "项目收尾后的记录更新";

/**
 * 项目已确认收尾且记录都已入库时, 再次运行 finish 的执行结果.
 * @type {string}
 */
const FINISHED_UNCHANGED_RESULT = "项目已确认收尾, 记录都已入库, 状态没有改动";

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
    return isProjectFinished(context.state, lastStage)
      ? settleFinishedRecords(context, now)
      : saveWithStageCommit(context, finishProject(context.state, lastStage), {
          now,
          mustCommitState: !isFinishCommitted(context.projectRoot, lastStage),
        });
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
        { now },
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
 * 项目已确认收尾后再次运行 finish: 记录 (含状态文件) 有未入库的改动时登记一次
 * 阶段提交, 否则不写状态.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文, 项目已确认收尾.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 有未处理的阶段提交时.
 */
function settleFinishedRecords(context, now) {
  const { state, spec, projectRoot } = context;
  assertNoStageCommit(state, replyStep(spec, STAGE_COMMIT_REPLY_TYPE));
  if (listUncommittedPaths(projectRoot, COMMITTED_PATHSPECS).length === 0) {
    return [
      `- 执行结果: ${FINISHED_UNCHANGED_RESULT}`,
      `- 下一动作: ${replyStep(spec, COMPLETE_REPLY_TYPE)}`,
    ];
  }
  return saveWithStageCommit(
    context,
    { ...state, lastAction: FINISHED_RECORDS_LABEL },
    { now, mustCommitState: true, label: FINISHED_RECORDS_LABEL },
  );
}

/**
 * 保存推进后的状态. 推进之前所在的阶段有尚未入库的技能产物, 或调用方要求带上
 * 状态文件时, 登记一次阶段提交, 下一动作是请用户选择提交范围; 未处理的阶段提交
 * 会拦住下一次推进.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文, 其中的状态是推进之前的状态.
 * @param {import("../lib/state.mjs").NavigatorState} advanced 推进后的状态.
 * @param {object} options 其它参数.
 * @param {string} options.now 当前时间.
 * @param {boolean} [options.mustCommitState] 推进写下的状态必须入库, 即使没有其它产物.
 * @param {string} [options.label] 阶段提交的名称; 省略时为 "阶段 N (名称) 完成".
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 有未处理的阶段提交时.
 */
function saveWithStageCommit(
  context,
  advanced,
  { now, mustCommitState = false, label },
) {
  const { state, spec, projectRoot } = context;
  const commitStep = replyStep(spec, STAGE_COMMIT_REPLY_TYPE);
  assertNoStageCommit(state, commitStep);
  const needsCommit =
    state.stage !== null &&
    (mustCommitState || listUncommittedProducts(projectRoot).length > 0);
  const saved = saveState(
    context,
    needsCommit
      ? requestStageCommit(
          advanced,
          label ?? `阶段 ${state.stage} (${spec.stages[state.stage]}) 完成`,
        )
      : advanced,
    now,
  );
  return [
    ...resultLines(saved),
    ...(needsCommit ? [`- 下一动作: ${commitStep}`] : []),
  ];
}

/**
 * 判断 HEAD 中入库的状态文件是否已记下项目完成. 仓库还没有提交, 状态文件没有
 * 入库或不是合法 JSON 时都算没有记下.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {number} lastStage 最后一个阶段的编号.
 * @returns {boolean} 已记下时返回 true.
 */
function isFinishCommitted(projectRoot, lastStage) {
  const blob = readGitBlob(projectRoot, `HEAD:${STATE_FILE}`);
  if (blob === undefined) {
    return false;
  }
  try {
    return isProjectFinished(JSON.parse(blob.toString("utf8")), lastStage);
  } catch {
    return false;
  }
}
