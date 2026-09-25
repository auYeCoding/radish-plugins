/**
 * @file 项目登记的 MCP 取证工具: 用户授权后, 验收子代理可以调用这些工具核对只有
 * 外部系统才看得到的结果, 例如抓包工具记下的请求.
 *
 * 编排会话判断不了一个 MCP 工具有没有副作用, 所以只登记用户在 "测试授权" 中
 * 逐个认可的工具名, 不接受通配符. 登记按项目保存, 此后每张工单都能使用.
 */

import { WorkflowError } from "./workflow-error.mjs";

/**
 * MCP 工具名的格式: `mcp__<服务器>__<工具>`, 不含空白与通配符.
 * @type {RegExp}
 */
const EVIDENCE_TOOL_PATTERN = /^mcp__[^\s*]+__[^\s*]+$/u;

/**
 * 登记覆盖此前的全部登记; 传入空列表即撤销.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {readonly string[]} tools 工具名.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 有工具名不是完整的 MCP 工具名时.
 */
export function registerEvidenceTools(state, tools) {
  const cleaned = [
    ...new Set(tools.map((tool) => tool.trim()).filter(Boolean)),
  ];
  const invalid = cleaned.filter((tool) => !EVIDENCE_TOOL_PATTERN.test(tool));
  if (invalid.length > 0) {
    throw new WorkflowError(
      `取证工具要写完整的 MCP 工具名, 例如 mcp__Reqable__capture_live_filter, 不用通配符: ${invalid.join(", ")}.`,
    );
  }
  return {
    ...state,
    evidenceTools: cleaned,
    lastAction: `登记取证工具 ${cleaned.length} 个`,
  };
}

/**
 * 描述已登记的取证工具, 用于命令输出与委派提示词.
 *
 * @param {readonly string[]} tools 已登记的工具名.
 * @returns {string} 描述; 没有登记时为 "无".
 */
export function describeEvidenceTools(tools) {
  return tools.length === 0 ? "无" : tools.join(", ");
}
