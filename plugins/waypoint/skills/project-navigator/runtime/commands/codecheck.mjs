/**
 * @file codecheck 命令: 登记项目的代码检查命令.
 *
 * 用法: codecheck set --from <草稿>, 草稿格式 {"commands": ["ruff check ."], "reason": ""}.
 * 没有合适的检查工具时, commands 为空, reason 写明原因.
 */

import { describeCodeChecks, registerCodeChecks } from "../lib/code-checks.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 执行 codecheck 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 用法不对或草稿不合法时.
 */
export function runCodeCheck({ positionals, values, cwd, now }) {
  if (positionals[0] !== "set") {
    throw new WorkflowError("codecheck 的用法: codecheck set --from <草稿>.");
  }
  const context = openProject(cwd);
  const draft = readDraftJson(context.projectRoot, values.from);
  const state = saveState(
    context,
    registerCodeChecks(context.state, {
      commands: Array.isArray(draft.commands) ? draft.commands.map(String) : [],
      reason: typeof draft.reason === "string" ? draft.reason : "",
    }),
    now,
  );
  return [
    ...resultLines(state),
    `- 代码检查: ${describeCodeChecks(state.codeChecks)}`,
  ];
}
