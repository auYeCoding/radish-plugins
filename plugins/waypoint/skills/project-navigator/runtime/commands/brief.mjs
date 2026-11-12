/**
 * @file brief 命令: 输出实现子代理与验收子代理的委派提示词.
 *
 * 用法: brief exec | brief review. 提示词只对进行中的切片生成, 编排会话原样使用.
 */

import { buildExecutorBrief, buildReviewBrief } from "../lib/briefs.mjs";
import { runFilterCheck } from "../lib/filters.mjs";
import { activeSlice } from "../lib/roadmap.mjs";
import { loadSliceSpec } from "../lib/slice-file.mjs";
import { SLICE_STATUSES, SLICE_STATUS_LABELS } from "../lib/state.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { openProject } from "./support.mjs";

/**
 * 提示词的种类.
 * @type {Readonly<{exec: string, review: string}>}
 */
const BRIEF_KINDS = Object.freeze({ exec: "exec", review: "review" });

/**
 * 每种提示词要求切片所处的状态.
 * @type {Readonly<Record<string, string>>}
 */
const REQUIRED_STATUSES = Object.freeze({
  [BRIEF_KINDS.exec]: SLICE_STATUSES.running,
  [BRIEF_KINDS.review]: SLICE_STATUSES.reviewing,
});

/**
 * 执行 brief 命令.
 *
 * @param {import("./handlers.mjs").CommandInvocation} invocation 命令调用.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 种类未知, 或进行中的切片不在对应状态时.
 */
export function runBrief({ positionals, cwd }) {
  const [kind] = positionals;
  if (kind === undefined || !Object.hasOwn(REQUIRED_STATUSES, kind)) {
    throw new WorkflowError(
      `brief 的用法: brief <${Object.keys(REQUIRED_STATUSES).join(" | ")}>.`,
    );
  }
  const { projectRoot, state } = openProject(cwd);
  const slice = activeSlice(state)?.slice;
  const required = REQUIRED_STATUSES[kind];
  if (
    slice === undefined ||
    state.current === null ||
    slice.status !== required
  ) {
    throw new WorkflowError(
      `brief ${kind} 要求进行中的切片处于 "${SLICE_STATUS_LABELS[required]}"${slice === undefined ? "; 现在没有进行中的切片" : `; 切片 ${slice.id} 现在是 "${SLICE_STATUS_LABELS[slice.status]}"`}.`,
    );
  }
  const context = {
    projectRoot,
    slice,
    current: state.current,
    project: state.project,
    spec: loadSliceSpec(),
  };
  if (kind === BRIEF_KINDS.review) {
    return buildReviewBrief({
      ...context,
      filterLines: runFilterCheck(projectRoot, state),
    }).split("\n");
  }
  if (slice.interactive) {
    throw new WorkflowError(
      `切片 ${slice.id} 是交互式切片, 在本会话执行, 不派实现子代理.`,
    );
  }
  return buildExecutorBrief(context).split("\n");
}
