/**
 * @file template 命令: 输出某种记录文件的骨架, "当前进展" 已按状态填好.
 *
 * 用法: template <文件种类> [--option <结构编号>], 文件种类为规格 files 中的键,
 * 例如 order, receipt, review, brief. 回执有两种结构: 1 为实现类, 2 为选型类.
 */

import { renderFileSkeleton } from "../lib/render.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import { loadSpec } from "../lib/spec.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { readStateIfValid } from "./support.mjs";

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
  const skeleton = renderFileSkeleton({
    fileSpec: spec.files[kind],
    variantIndex: Number(values.option ?? "1") - 1,
    state:
      projectRoot === undefined ? undefined : readStateIfValid(projectRoot),
    spec,
  });
  return skeleton.trimEnd().split("\n");
}
