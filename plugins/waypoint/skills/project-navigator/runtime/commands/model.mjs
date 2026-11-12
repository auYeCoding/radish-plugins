/**
 * @file model 命令: 查看与登记各类子代理使用的模型.
 *
 * 用法:
 * - model: 查看当前分配.
 * - model set <角色> <模型> [--kind <工单类型>]: 登记; `--kind` 只用于执行子代理,
 *   按工单类型单独指定.
 */

import {
  MODEL_CHOICES,
  MODEL_ROLES,
  assignModel,
  describeModels,
} from "../lib/subagent-models.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { openProject, resultLines, saveState } from "./support.mjs";

/**
 * 执行 model 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 用法不对, 或角色, 模型, 工单类型不合法时.
 */
export function runModel({ positionals, values, cwd, now }) {
  const context = openProject(cwd);
  const [action, role, model] = positionals;
  if (action === undefined) {
    return [`- 子代理模型: ${describeModels(context.state.models)}`];
  }
  if (action !== "set" || role === undefined || model === undefined) {
    throw new WorkflowError(
      `model 的用法: model; model set <角色> <模型> [--kind <工单类型>]. 角色: ${Object.values(MODEL_ROLES).join(", ")}; 模型: ${MODEL_CHOICES.join(", ")}.`,
    );
  }
  const state = saveState(
    context,
    assignModel(context.state, {
      role,
      model,
      kind: typeof values.kind === "string" ? values.kind : undefined,
    }),
    now,
  );
  return [
    ...resultLines(state),
    `- 子代理模型: ${describeModels(state.models)}`,
  ];
}
