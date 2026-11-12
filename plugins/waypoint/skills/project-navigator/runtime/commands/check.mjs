/**
 * @file check 命令: 记录自查与筛选器检查. 只读, 不改任何文件.
 *
 * 用法: check [--filters].
 * - 不带参数: 核对状态与记录文件是否对得上, 进行中的切片文件是否读得出来.
 * - --filters: 模块用筛选器表达的项目, 核对每个源文件都归入了筛选器.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { REQUIREMENTS_FILE } from "../lib/paths.mjs";
import { activeSlice } from "../lib/roadmap.mjs";
import {
  PARTS,
  findUnfilledSections,
  loadSliceSpec,
  partSpec,
  readSliceFile,
  readVerdicts,
} from "../lib/slice-file.mjs";
import { ORGANIZATIONS, SLICE_STATUSES, STAGES } from "../lib/state.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { runFilterCheck } from "../lib/filters.mjs";
import { openProject } from "./support.mjs";

/**
 * 切片处于各状态时, 应该已经填好的段.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const FILLED_PARTS = Object.freeze({
  [SLICE_STATUSES.running]: [PARTS.plan],
  [SLICE_STATUSES.reviewing]: [PARTS.plan, PARTS.result],
});

/**
 * 执行 check 命令.
 *
 * @param {import("./handlers.mjs").CommandInvocation} invocation 命令调用.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 带 --filters 而项目不用筛选器表达模块时.
 */
export function runCheck({ values, cwd }) {
  const { projectRoot, state } = openProject(cwd);
  if (values.filters === true) {
    if (state.project.organization !== ORGANIZATIONS.filters) {
      throw new WorkflowError(
        `筛选器检查只用于模块组织方式为 ${ORGANIZATIONS.filters} 的项目.`,
      );
    }
    return runFilterCheck(projectRoot, state);
  }
  const problems = [
    ...recordProblems(projectRoot, state),
    ...sliceProblems(projectRoot, state),
  ];
  return problems.length === 0
    ? ["- 自查结果: 没有问题"]
    : [
        `- 自查结果: ${problems.length} 个问题`,
        ...problems.map((problem) => `  - ${problem}`),
      ];
}

/**
 * 核对状态与记录文件是否对得上.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @returns {string[]} 问题列表.
 */
function recordProblems(projectRoot, state) {
  const missingSliceFiles = state.milestones
    .flatMap((milestone) => milestone.slices)
    .filter(
      (slice) =>
        slice.file !== null && !existsSync(path.join(projectRoot, slice.file)),
    )
    .map((slice) => `切片 ${slice.id} 的文件 ${slice.file} 不存在.`);
  return [
    ...(state.stage !== STAGES.intake &&
    !existsSync(path.join(projectRoot, REQUIREMENTS_FILE))
      ? [`需求文件 ${REQUIREMENTS_FILE} 不存在.`]
      : []),
    ...missingSliceFiles,
    ...(state.current !== null && activeSlice(state) === undefined
      ? [`状态中进行中的切片 ${state.current.sliceId} 不在路线里.`]
      : []),
  ];
}

/**
 * 核对进行中的切片文件: 按切片状态应该填好的段是否填好, 标准核对表是否合格.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @returns {string[]} 问题列表.
 */
function sliceProblems(projectRoot, state) {
  const slice = activeSlice(state)?.slice;
  const spec = loadSliceSpec();
  const parsed =
    slice === undefined
      ? undefined
      : readSliceFile(projectRoot, slice.file, spec);
  if (slice === undefined || parsed === undefined) {
    return [];
  }
  return [
    ...(FILLED_PARTS[slice.status] ?? []).flatMap((partId) =>
      findUnfilledSections({ parsed, spec, partId, kind: slice.kind }).map(
        (title) =>
          `${slice.file}: "${partSpec(spec, partId).heading}" 段的 "${title}" 没有填好.`,
      ),
    ),
    ...readVerdicts(parsed, spec).problems.map(
      (problem) => `${slice.file}: ${problem}`,
    ),
  ];
}
