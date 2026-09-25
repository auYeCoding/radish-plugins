/**
 * @file tools 命令: 登记用户授权验收子代理调用的 MCP 取证工具.
 *
 * 用法: tools set --from <草稿>, 草稿格式 {"tools": ["mcp__Reqable__capture_live_filter"]}.
 * 登记覆盖此前的全部登记, 草稿中写空列表即撤销.
 */

import {
  describeEvidenceTools,
  registerEvidenceTools,
} from "../lib/evidence-tools.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 执行 tools 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 用法不对或草稿不合法时.
 */
export function runTools({ positionals, values, cwd, now }) {
  if (positionals[0] !== "set") {
    throw new WorkflowError("tools 的用法: tools set --from <草稿>.");
  }
  const context = openProject(cwd);
  const draft = readDraftJson(context.projectRoot, values.from);
  const state = saveState(
    context,
    registerEvidenceTools(
      context.state,
      Array.isArray(draft.tools) ? draft.tools.map(String) : [],
    ),
    now,
  );
  return [
    ...resultLines(state),
    `- 取证工具: ${describeEvidenceTools(state.evidenceTools)}`,
  ];
}
