/**
 * @file 插件 hook 的统一入口, 由插件的 `hooks/hooks.json` 以 `node <本文件>`
 * 调用, 从标准输入读取事件 JSON.
 *
 * 插件的 hook 在所有项目中都会触发; 项目中没有 `.navigator/state.json`, 或项目
 * 已卸载时, 本脚本立即结束, 不做任何事. 已初始化的项目中:
 *
 * - 工具调用前: 写入类工具按守卫的四条规则放行或拒绝.
 * - 用户发消息时: 编排会话注入位置与要点, 并记下用户对工单审阅的选择.
 * - 会话开始时 (含恢复与上下文压缩后): 编排会话注入位置; 压缩后另提示重新查询.
 * - 回复结束时: 校验编排会话回复的结构, 不合格时打回一次; 回复工单审阅后开始
 *   等待用户选择.
 *
 * 编排会话不做登记, 按会话转录中的编排标记判断 (见 lib/orchestrator-marker.mjs).
 * 脚本出错时一律放行, 不卡住会话. 本脚本从不以退出码 2 结束: "用户发消息时"
 * 事件以退出码 2 结束会清掉用户输入.
 */

import { existsSync, readFileSync } from "node:fs";

import {
  EVENT_KINDS,
  recordEvent,
  stackLines,
  unreportedEvents,
} from "./lib/diagnostics.mjs";
import { WRITE_TOOLS, decideWrite } from "./lib/guard.mjs";
import {
  APPROVAL_REPLY_TYPE,
  applyApprovalAnswer,
  markAwaitingApproval,
} from "./lib/order-approval.mjs";
import {
  isOrchestratorTranscript,
  readTranscript,
} from "./lib/orchestrator-marker.mjs";
import { findWorktreeRoot, navigatorPath } from "./lib/paths.mjs";
import {
  diagnosticsReminder,
  orchestratorCompactReminder,
  orchestratorReminder,
} from "./lib/reminders.mjs";
import { checkReply, locateReply } from "./lib/reply-checks.mjs";
import { loadSpec } from "./lib/spec.mjs";
import { INIT_UNINSTALLED, readStateIfValid } from "./lib/state.mjs";

/**
 * 回复结构不合格时, 打回原因的开头. 只让模型改列出的问题: 重写整条回复
 * 容易引入新的错误, 而重写后的回复不再校验.
 * @type {string}
 */
const REPLY_REJECTION_HEADER =
  "回复结构不合格. 只修改下列问题, 其余内容原样保留, 然后重新输出完整回复:";

/**
 * 会话开始事件中表示上下文压缩之后的来源值.
 * @type {string}
 */
const COMPACT_SOURCE = "compact";

/**
 * 记录 hook 错误时, 输入中没有事件名时写的来源.
 * @type {string}
 */
const UNKNOWN_EVENT = "未知事件";

/**
 * 可以请用户审阅的工单状态: 起草中, 以及受阻后修改待重新发布.
 * @type {readonly string[]}
 */
const REVIEWABLE_STATUSES = Object.freeze(["drafting", "blocked"]);

/**
 * @typedef {object} HookEvent 一次 hook 调用的上下文.
 * @property {Record<string, any>} input hook 输入.
 * @property {string} projectRoot 项目根目录.
 * @property {import("./lib/state.mjs").NavigatorState} state 当前状态.
 * @property {() => boolean} isOrchestrator 判断本会话是否为编排会话, 结果在本次调用中缓存.
 * @property {string} now 当前时间, ISO 格式.
 */

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
  if (
    projectRoot === undefined ||
    !existsSync(navigatorPath(projectRoot, "state"))
  ) {
    return;
  }
  try {
    const state = readStateIfValid(projectRoot);
    if (state === undefined || state.init.status === INIT_UNINSTALLED) {
      return;
    }
    const output = handleEvent({
      input,
      projectRoot,
      state,
      isOrchestrator: memoize(() =>
        isOrchestratorTranscript(
          readTranscript(input.transcript_path),
          projectRoot,
        ),
      ),
      now: new Date().toISOString(),
    });
    if (output !== undefined) {
      process.stdout.write(JSON.stringify(output));
    }
  } catch (error) {
    recordHookError(projectRoot, input, error);
  }
}

/**
 * 记下 hook 的内部错误, 供问题报告使用. hook 出错时一律放行, 所以这里只记录,
 * 不输出; 记录本身出错时也不影响放行.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {Record<string, any>} input hook 输入.
 * @param {unknown} error 捕获到的错误.
 * @returns {void}
 */
function recordHookError(projectRoot, input, error) {
  try {
    recordEvent(projectRoot, {
      kind: EVENT_KINDS.hookError,
      source: String(input.hook_event_name ?? UNKNOWN_EVENT),
      message: error instanceof Error ? error.message : String(error),
      stack: stackLines(error),
      at: new Date().toISOString(),
    });
  } catch {
    return;
  }
}

/**
 * 按事件分发.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON; 不输出时为 undefined.
 */
function handleEvent(event) {
  switch (event.input.hook_event_name) {
    case "PreToolUse":
      return handlePreToolUse(event);
    case "UserPromptSubmit":
      return handleUserPrompt(event);
    case "SessionStart":
      return handleSessionStart(event);
    case "Stop":
      return handleStop(event);
    default:
      return undefined;
  }
}

/**
 * 处理工具调用前事件: 写入类工具交给守卫判定, 拒绝时输出理由.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handlePreToolUse({ input, projectRoot, state, isOrchestrator }) {
  if (!WRITE_TOOLS.includes(String(input.tool_name ?? ""))) {
    return undefined;
  }
  const decision = decideWrite({
    projectRoot,
    toolInput: input.tool_input ?? {},
    isSubagent: typeof input.agent_id === "string",
    agentType:
      typeof input.agent_type === "string" ? input.agent_type : undefined,
    order: state.order,
    isOrchestrator,
  });
  return decision.decision === "deny"
    ? denyOutput(decision.reason ?? "")
    : undefined;
}

/**
 * 处理用户发消息事件: 编排会话记下用户对工单审阅的选择, 并注入位置与要点.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleUserPrompt({ input, projectRoot, state, isOrchestrator, now }) {
  if (!isOrchestrator()) {
    return undefined;
  }
  const spec = loadSpec();
  applyApprovalAnswer({
    projectRoot,
    order: state.order,
    prompt: String(input.prompt ?? ""),
    spec,
    now,
  });
  return contextOutput(
    "UserPromptSubmit",
    [
      orchestratorReminder(state, spec),
      ...diagnosticsReminder(unreportedEvents(projectRoot).length),
    ].join("\n"),
  );
}

/**
 * 处理会话开始事件: 编排会话注入位置; 上下文压缩后另提示重新查询下一动作.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleSessionStart({ input, state, isOrchestrator }) {
  if (!isOrchestrator()) {
    return undefined;
  }
  const spec = loadSpec();
  return contextOutput(
    "SessionStart",
    input.source === COMPACT_SOURCE
      ? orchestratorCompactReminder(state, spec)
      : orchestratorReminder(state, spec),
  );
}

/**
 * 处理回复结束事件: 校验编排会话回复的结构, 不合格时打回一次. 工单审阅合格,
 * 或本轮不校验时, 开始等待用户对工单审阅的选择.
 *
 * `stop_hook_active` 为 true 表示本轮已被打回过, 此时不再校验, 避免循环.
 * 有后台任务时照常校验: 等待子代理的回复有自己的类型 ("工单执行", "工单验收", "等待结果").
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleStop({ input, projectRoot, state, isOrchestrator, now }) {
  const text =
    typeof input.last_assistant_message === "string"
      ? input.last_assistant_message
      : "";
  if (text === "" || !isOrchestrator()) {
    return undefined;
  }
  const problems =
    input.stop_hook_active === true
      ? []
      : checkReply({ text, spec: loadSpec() });
  if (problems.length > 0) {
    return {
      decision: "block",
      reason: [
        REPLY_REJECTION_HEADER,
        ...problems.map((problem, index) => `${index + 1}. ${problem}`),
      ].join("\n"),
    };
  }
  if (
    locateReply(text).heading?.text === APPROVAL_REPLY_TYPE &&
    state.order !== null &&
    REVIEWABLE_STATUSES.includes(state.order.status)
  ) {
    markAwaitingApproval(projectRoot, state.order, now);
  }
  return undefined;
}

/**
 * 包装一个无参数函数, 第一次调用后缓存结果.
 *
 * @template T
 * @param {() => T} compute 计算函数.
 * @returns {() => T} 带缓存的函数.
 */
function memoize(compute) {
  let isComputed = false;
  /** @type {T | undefined} */
  let value;
  return () => {
    if (!isComputed) {
      value = compute();
      isComputed = true;
    }
    return /** @type {T} */ (value);
  };
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

/**
 * 构造拒绝工具调用的输出.
 *
 * @param {string} reason 拒绝理由.
 * @returns {Record<string, unknown>} hook 输出 JSON.
 */
function denyOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

main();
