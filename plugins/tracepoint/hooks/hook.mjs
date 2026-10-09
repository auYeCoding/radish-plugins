/**
 * @file tracepoint 所有 hook 事件的统一入口, 由 `hooks/hooks.json` 以
 * `node <本文件>` 调用, 从标准输入读取事件 JSON.
 *
 * 职责只有注入上下文与记录进度, 不拒绝任何工具调用: 作为随插件包分发的插件,
 * 宁可少管也不误拒, 以便与其它插件和用户的全局 hook 共存.
 *
 * - 会话开始 (含恢复, 分叉, 清空与压缩后): 注入案卷摘要, 提醒先读案卷.
 * - 用户发消息: 注入一两行案卷锚点; 消息像一次纠正时, 另附缺陷记录提示.
 * - 工具调用后 (仅 MCP 工具, 由 matcher 限定): 把调用记进案卷, 供查重.
 *
 * 门控: 只有从会话工作目录向上找得到 `.tracepoint/` 案卷时才动作; 否则完全静默,
 * 不打扰其它项目或 project-navigator 的编排会话. 子代理 (只读) 里不注入.
 *
 * 失败策略: 任何错误都静默放行, 插件 hook 不应因自身 bug 卡住用户的逆向会话;
 * 本脚本从不以退出码 2 结束, 不拒绝工具调用.
 */

import { readFileSync } from "node:fs";

import {
  appendToolCall,
  readCase,
  renderCaseAnchor,
  renderCaseSummary,
} from "../runtime/lib/case-file.mjs";
import { findCaseDir } from "../runtime/lib/paths.mjs";
import { looksLikeCorrection } from "../runtime/lib/self-iteration.mjs";

/**
 * 像被纠正时注入的缺陷记录提示 (自迭代的自动触发). 只提示记事实, 不让代理下根因.
 * @type {string}
 */
const DEFECT_PROMPT =
  '[tracepoint] 上一步似乎被纠正了. 若与某条工作流规则有关, 往 .tracepoint/defects/ 追加一条缺陷记录 (一个 JSON 文件), 只写事实: {"plugin":"tracepoint","skill":"","rule":"","patternKey":"","sawWhat":"","didWhat":"","result":"","task":"","at":""}; 不要判断是规则错还是自己错, 归因留给 /tracepoint:review. 与规则无关就忽略本提示.';

/**
 * 读取事件, 门控, 分发处理, 输出结果.
 *
 * @returns {void}
 */
function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  try {
    if (typeof input.agent_id === "string") {
      return;
    }
    const startDir =
      process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    const caseDir = findCaseDir(startDir);
    if (caseDir === undefined) {
      return;
    }
    const output = handleEvent(input, caseDir);
    if (output !== undefined) {
      process.stdout.write(JSON.stringify(output));
    }
  } catch {
    // 失败放行: 不因插件自身问题打断用户的会话.
  }
}

/**
 * 按事件分发.
 *
 * @param {Record<string, any>} input hook 输入.
 * @param {string} caseDir 案卷目录.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON; 不输出时为 undefined.
 */
function handleEvent(input, caseDir) {
  switch (String(input.hook_event_name ?? "")) {
    case "SessionStart":
      return contextOutput(
        "SessionStart",
        renderCaseSummary(readCase(caseDir)),
      );
    case "UserPromptSubmit": {
      const anchor = renderCaseAnchor(readCase(caseDir));
      const text = looksLikeCorrection(String(input.prompt ?? ""))
        ? `${anchor}\n${DEFECT_PROMPT}`
        : anchor;
      return contextOutput("UserPromptSubmit", text);
    }
    case "PostToolUse":
      recordToolCall(input, caseDir);
      return undefined;
    default:
      return undefined;
  }
}

/**
 * 把一次工具调用记进案卷 (查重用). 由 PostToolUse 的 matcher 限定只对 MCP 工具触发.
 *
 * @param {Record<string, any>} input hook 输入.
 * @param {string} caseDir 案卷目录.
 * @returns {void}
 */
function recordToolCall(input, caseDir) {
  const name = String(input.tool_name ?? "");
  if (name === "") {
    return;
  }
  appendToolCall(caseDir, {
    name,
    target: toolTarget(input.tool_input),
    at: new Date().toISOString(),
  });
}

/**
 * 从工具参数里取一个能代表 "分析对象" 的标识, 用于查重.
 *
 * @param {unknown} toolInput 工具参数.
 * @returns {string} 标识; 取不到时为空串.
 */
function toolTarget(toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) {
    return "";
  }
  const record = /** @type {Record<string, unknown>} */ (toolInput);
  const candidate =
    record.file_path ??
    record.name ??
    record.address ??
    record.function ??
    record.ea ??
    record.query;
  return typeof candidate === "string" ? candidate : "";
}

/**
 * 构造注入上下文的输出.
 *
 * @param {string} eventName 事件名.
 * @param {string} text 注入的文字.
 * @returns {Record<string, unknown>} hook 输出 JSON.
 */
function contextOutput(eventName, text) {
  return {
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  };
}

main();
