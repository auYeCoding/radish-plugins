/**
 * @file 插件 hook 的统一入口, 由插件的 `hooks/hooks.json` 以 `node <本文件>`
 * 调用, 从标准输入读取事件 JSON.
 *
 * 插件的 hook 在所有项目中都会触发; 项目中没有当前结构的状态文件, 或项目已卸载
 * 时, 本脚本立即结束, 不做任何事. 已初始化的项目中:
 *
 * - 工具调用前: 写入类工具按守卫的四条规则放行或拒绝.
 * - 用户发消息时与会话开始时 (含恢复与上下文压缩后): 向编排会话注入位置与
 *   下一动作.
 *
 * 编排会话不做登记, 按会话转录中的编排标记判断 (见 lib/orchestrator-marker.mjs).
 * 脚本出错时一律放行, 不卡住会话. 本脚本从不以退出码 2 结束: "用户发消息时"
 * 事件以退出码 2 结束会清掉用户输入.
 */

import { readFileSync } from "node:fs";

import { WRITE_TOOLS, decideWrite } from "./lib/guard.mjs";
import {
  command,
  nextAction,
  progressLine,
  readFacts,
} from "./lib/guidance.mjs";
import {
  isOrchestratorTranscript,
  readTranscript,
} from "./lib/orchestrator-marker.mjs";
import { COMMAND_NAME, findWorktreeRoot } from "./lib/paths.mjs";
import { activeSlice } from "./lib/roadmap.mjs";
import { INIT_ACTIVE, readState } from "./lib/state.mjs";

/**
 * 会话开始事件中表示上下文压缩之后的来源值.
 * @type {string}
 */
const COMPACT_SOURCE = "compact";

/**
 * 注入上下文的事件名.
 * @type {readonly string[]}
 */
const REMINDER_EVENTS = Object.freeze(["UserPromptSubmit", "SessionStart"]);

/**
 * 工具调用前的事件名.
 * @type {string}
 */
const PRE_TOOL_EVENT = "PreToolUse";

/**
 * 位置提醒之后固定附上的规则.
 * @type {string}
 */
const REMINDER_RULES =
  "规则: 编排会话不写业务代码; 状态只用插件命令修改; 回复按技能的三种回复版式写, 第一段一句结论, 要用户决定时紧跟选项代码块, 有提问框工具时用它; 当前切片之外的想法记进待办, 不顺手做.";

/**
 * 读取事件, 分发处理, 输出结果.
 *
 * @returns {void}
 */
function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const projectRoot = findWorktreeRoot(
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd(),
  );
  if (projectRoot === undefined) {
    return;
  }
  try {
    const state = readState(projectRoot);
    if (state === undefined || state.init.status !== INIT_ACTIVE) {
      return;
    }
    const output = handleEvent(input, projectRoot, state);
    if (output !== undefined) {
      process.stdout.write(JSON.stringify(output));
    }
  } catch {
    return;
  }
}

/**
 * 按事件分发.
 *
 * @param {Record<string, any>} input hook 输入.
 * @param {string} projectRoot 项目根目录.
 * @param {import("./lib/state.mjs").NavigatorState} state 当前状态.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON; 不输出时为 undefined.
 */
function handleEvent(input, projectRoot, state) {
  const isOrchestrator = () =>
    isOrchestratorTranscript(
      readTranscript(input.transcript_path),
      projectRoot,
    );
  if (input.hook_event_name === PRE_TOOL_EVENT) {
    return handlePreToolUse(input, projectRoot, state, isOrchestrator);
  }
  if (
    !REMINDER_EVENTS.includes(input.hook_event_name) ||
    typeof input.agent_id === "string" ||
    !isOrchestrator()
  ) {
    return undefined;
  }
  return {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name,
      additionalContext: reminder(
        projectRoot,
        state,
        input.source === COMPACT_SOURCE,
      ),
    },
  };
}

/**
 * 处理工具调用前事件: 写入类工具交给守卫判定, 拒绝时输出理由.
 *
 * @param {Record<string, any>} input hook 输入.
 * @param {string} projectRoot 项目根目录.
 * @param {import("./lib/state.mjs").NavigatorState} state 当前状态.
 * @param {() => boolean} isOrchestrator 判断本会话是否为编排会话.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handlePreToolUse(input, projectRoot, state, isOrchestrator) {
  if (!WRITE_TOOLS.includes(String(input.tool_name ?? ""))) {
    return undefined;
  }
  const decision = decideWrite({
    projectRoot,
    toolInput: input.tool_input ?? {},
    isSubagent: typeof input.agent_id === "string",
    agentType:
      typeof input.agent_type === "string" ? input.agent_type : undefined,
    sliceFile: activeSlice(state)?.slice.file ?? null,
    isOrchestrator,
  });
  return decision.decision === "deny"
    ? {
        hookSpecificOutput: {
          hookEventName: PRE_TOOL_EVENT,
          permissionDecision: "deny",
          permissionDecisionReason: decision.reason ?? "",
        },
      }
    : undefined;
}

/**
 * 生成注入编排会话的位置提醒.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("./lib/state.mjs").NavigatorState} state 当前状态.
 * @param {boolean} isAfterCompact 是否在上下文压缩之后.
 * @returns {string} 提醒全文.
 */
function reminder(projectRoot, state, isAfterCompact) {
  return [
    ...(isAfterCompact
      ? [
          `[${COMMAND_NAME}] 上下文已压缩: 以下面的位置为准, 需要细节时运行 ${command("status")} 与对应的 ref.`,
        ]
      : []),
    `[${COMMAND_NAME}] 位置: ${progressLine(state)}.`,
    `下一动作: ${nextAction(state, readFacts(projectRoot, state))}`,
    REMINDER_RULES,
  ].join("\n");
}

main();
