/**
 * @file template 命令: 输出某种记录文件的骨架, "当前进展" 已按状态填好;
 * 会改动代码的工单, 验收判据第一条预填代码检查判据.
 *
 * 用法: template <文件种类> [--option <结构编号>], 文件种类为规格 files 中的键,
 * 例如 order, receipt, review, brief. 回执有两种结构: 1 为实现类, 2 为选型类.
 */

import { orderSkeletonPrefills } from "../lib/code-checks.mjs";
import { renderFileSkeleton } from "../lib/render.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import { loadSpec } from "../lib/spec.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { readStateIfValid } from "./support.mjs";

/**
 * 工单文件的种类名; 工单骨架按当前工单预填代码检查判据.
 * @type {string}
 */
const ORDER_FILE_KIND = "order";

/**
 * 执行 template 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 文件种类不存在时.
 */
export function runTemplate({ positionals, values, cwd }) {
  const spec = loadSpec();
  const [kind] = positionals;
  if (kind === undefined || !Object.hasOwn(spec.files, kind)) {
    throw new WorkflowError(
      `template 的用法: template <文件种类>, 文件种类为 ${Object.keys(spec.files).join(", ")} 之一.`,
    );
  }
  const projectRoot = findRepositoryRoot(cwd);
  const state =
    projectRoot === undefined ? undefined : readStateIfValid(projectRoot);
  const skeleton = renderFileSkeleton({
    fileSpec: spec.files[kind],
    variantIndex: Number(values.option ?? "1") - 1,
    state,
    spec,
    prefills: kind === ORDER_FILE_KIND ? orderSkeletonPrefills(state) : {},
  });
  return skeleton.trimEnd().split("\n");
}
