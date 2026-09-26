/**
 * @file 所有 hook 事件的统一入口, 由项目 `.claude/settings.json` 以
 * `node <本文件>` 调用, 从标准输入读取事件 JSON.
 *
 * - 工具调用前: 按会话身份判定放行或拒绝; 探测写入时留下自检心跳.
 * - 工具调用后: 状态目录中的文件被写入后, 把这个文件并入快照; 读取当前工单文件的
 *   会话登记为执行会话.
 * - 用户发消息时: 编排会话注入位置与禁令, 记下消息原文供核对用户测试输出, 并记下
 *   用户对工单审阅的选择; 被接管的原编排会话注入身份提醒; 识别启动提示词并登记
 *   执行会话; 识别用户对开工对齐的选择.
 * - 会话开始时 (含上下文压缩后): 注入身份与位置提醒.
 * - 回复结束时: 校验编排会话与执行会话的回复版式, 不合格时打回一次; 编排会话回复
 *   工单审阅后开始等待用户选择.
 *
 * 会话身份以运行期登记目录中的编排会话登记为准, 不读状态文件, 回退记录不会改变
 * 身份. 快照只在写入时增量更新, 回复结束时不整体拍摄, 以免把其它程序对记录的改动
 * (例如 `git reset`) 悄悄并入快照.
 *
 * 失败策略: 编排会话的工具调用守卫出错时拦截 (宁可停下也不放过越权操作);
 * 其它会话与其它事件出错时放行, 避免脚本故障卡住与编排无关的工作.
 * 本脚本从不以退出码 2 结束: "用户发消息时" 事件以退出码 2 结束会清掉用户输入.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { RESEARCH_FRAME, buildReviewBrief } from "./lib/briefs.mjs";
import { orderTestCommands } from "./lib/code-checks.mjs";
import {
  ALIGNMENT_REPLY_TYPE,
  applyAlignmentAnswer,
  executorGuardState,
  findLaunchedOrder,
  orderReadBy,
  registerExecutor,
} from "./lib/executors.mjs";
import { WRITE_TOOLS, decideToolUse } from "./lib/guard.mjs";
import {
  APPROVAL_REPLY_TYPE,
  applyApprovalAnswer,
  markAwaitingApproval,
  readOrderText,
} from "./lib/order-approval.mjs";
import {
  blankOrderExcerpt,
  checkOrderExcerpt,
  hasOrderExcerpt,
} from "./lib/order-excerpt.mjs";
import {
  NAVIGATOR_DIRECTORY,
  findWorktreeRoot,
  isUnderDirectory,
  projectRelativePath,
} from "./lib/paths.mjs";
import { headCommit } from "./lib/repo.mjs";
import {
  appendPrompt,
  readExecutorRecord,
  readRecentPrompts,
  writeExecutorRecord,
  writeProbeHeartbeat,
} from "./lib/registry.mjs";
import {
  executorReminder,
  orchestratorReminder,
  orchestratorResumeReminder,
} from "./lib/reminders.mjs";
import { checkReply, locateReply } from "./lib/reply-checks.mjs";
import { criteriaTableSpec } from "./lib/review-record.mjs";
import { supersededReminder } from "./lib/session-notices.mjs";
import { identifyRole, readOrchestrators } from "./lib/sessions.mjs";
import { recordSnapshotChanges } from "./lib/snapshots.mjs";
import { findReply, loadSpec } from "./lib/spec.mjs";
import { INIT_UNINSTALLED, readState } from "./lib/state.mjs";
import { checkWriting, formatFinding } from "./lib/writing-checks.mjs";

/**
 * 回复版式不合格时, 打回原因的开头. 只让模型改列出的问题: 重写整条回复
 * 容易引入新的错误, 而重写后的回复不再校验.
 * @type {string}
 */
const REPLY_REJECTION_HEADER =
  "回复版式不合格. 只修改下列问题, 其余内容原样保留, 然后重新输出完整回复:";

/**
 * 打回原因中最多列出的写作问题条数, 避免原因过长.
 * @type {number}
 */
const MAX_WRITING_PROBLEMS = 8;

/**
 * 编排会话回复时跳过版式校验的工单状态: 正在提交时, 回复由 commit-message 技能输出.
 * @type {string}
 */
const COMMITTING_STATUS = "committing";

/**
 * 读取文件的工具名.
 * @type {string}
 */
const READ_TOOL = "Read";

/**
 * @typedef {object} HookEvent 一次 hook 调用的上下文.
 * @property {Record<string, any>} input hook 输入.
 * @property {string} projectRoot 项目根目录.
 * @property {import("./lib/state.mjs").NavigatorState} state 当前状态.
 * @property {import("./lib/registry.mjs").OrchestratorRecord} orchestrators 编排会话登记.
 * @property {import("./lib/sessions.mjs").SessionRole} role 会话身份.
 * @property {string} sessionId 会话编号.
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
  const state =
    projectRoot === undefined ? undefined : readStateOrUndefined(projectRoot);
  if (
    projectRoot === undefined ||
    state === undefined ||
    state.init.status === INIT_UNINSTALLED
  ) {
    return;
  }
  const sessionId = String(input.session_id ?? "");
  let role = "other";
  try {
    const orchestrators = readOrchestrators(projectRoot);
    role = identifyRole({
      orchestrators,
      executorRecord: readExecutorRecord(projectRoot, sessionId),
      sessionId,
    });
    const output = handleEvent({
      input,
      projectRoot,
      state,
      orchestrators,
      role,
      sessionId,
      now: new Date().toISOString(),
    });
    if (output !== undefined) {
      process.stdout.write(JSON.stringify(output));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.hook_event_name === "PreToolUse" && role === "orchestrator") {
      process.stdout.write(
        JSON.stringify(denyOutput(`守卫脚本出错, 已拦下本次调用: ${message}`)),
      );
    }
  }
}

/**
 * 读取状态文件; 文件损坏时返回 undefined, 此时 hook 不做任何限制,
 * 让恢复命令能够运行.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {import("./lib/state.mjs").NavigatorState | undefined} 状态.
 */
function readStateOrUndefined(projectRoot) {
  try {
    return readState(projectRoot);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
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
    case "PostToolUse":
      return handlePostToolUse(event);
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
 * 处理工具调用前事件: 调用守卫, 拒绝时输出理由; 探测写入时记录心跳.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handlePreToolUse({ input, projectRoot, state, role, sessionId, now }) {
  const record =
    role === "executor"
      ? readExecutorRecord(projectRoot, sessionId)
      : undefined;
  const testCommands = orderTestCommands(state);
  const spec = loadSpec();
  const decision = decideToolUse({
    role,
    isSubagent: typeof input.agent_id === "string",
    agentType:
      typeof input.agent_type === "string" ? input.agent_type : undefined,
    toolName: String(input.tool_name ?? ""),
    toolInput: input.tool_input ?? {},
    projectRoot,
    context: {
      orderStatus: state.order?.status,
      authorizedTests: testCommands,
      evidenceTools: state.evidenceTools,
      ...executorGuardState(record, state),
      reviewBrief:
        state.order === null
          ? undefined
          : buildReviewBrief({
              projectRoot,
              order: state.order,
              testCommands,
              evidenceTools: state.evidenceTools,
              criteriaTable: criteriaTableSpec(spec),
            }),
      researchFrame: RESEARCH_FRAME,
    },
    readFile: (relativePath) => readProjectFile(projectRoot, relativePath),
    readRecentPrompts: () => readRecentPrompts(projectRoot),
    spec,
  });
  if (decision.isProbe === true) {
    writeProbeHeartbeat(projectRoot, sessionId, now);
  }
  return decision.decision === "deny"
    ? denyOutput(decision.reason ?? "")
    : undefined;
}

/**
 * 处理工具调用后事件: 状态目录中的文件被写入后, 把这个文件并入快照 (对账异常
 * 尚未处理时不拍); 其它会话读取当前工单文件时, 登记为执行会话 (启动提示词没有
 * 被识别时的兜底).
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handlePostToolUse({
  input,
  projectRoot,
  state,
  role,
  sessionId,
  now,
}) {
  const toolName = String(input.tool_name ?? "");
  const filePath =
    input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof filePath !== "string") {
    return undefined;
  }
  if (WRITE_TOOLS.includes(toolName)) {
    const relative = projectRelativePath(projectRoot, filePath);
    if (
      relative !== undefined &&
      isUnderDirectory(relative, NAVIGATOR_DIRECTORY) &&
      state.pendingAnomaly === undefined
    ) {
      recordSnapshotChanges(projectRoot, {
        paths: [relative],
        now,
        head: headCommit(projectRoot),
      });
    }
    return undefined;
  }
  if (toolName !== READ_TOOL || role !== "other") {
    return undefined;
  }
  const order = orderReadBy(state, projectRoot, filePath);
  if (
    order === undefined ||
    !registerExecutor({ worktreeRoot: projectRoot, sessionId, order, now })
  ) {
    return undefined;
  }
  return contextOutput(
    "PostToolUse",
    executorReminder(readExecutorRecord(projectRoot, sessionId)),
  );
}

/**
 * 处理用户发消息事件. 编排会话注入位置与禁令, 记下消息原文与对工单审阅的选择;
 * 被接管的原编排会话注入身份提醒; 执行会话记录用户对开工对齐的选择;
 * 启动提示词把会话登记为执行会话.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleUserPrompt({
  input,
  projectRoot,
  state,
  orchestrators,
  role,
  sessionId,
  now,
}) {
  const prompt = String(input.prompt ?? "");
  const spec = loadSpec();
  if (role === "orchestrator") {
    appendPrompt(projectRoot, prompt, now);
    applyApprovalAnswer({ projectRoot, order: state.order, prompt, spec, now });
    return contextOutput("UserPromptSubmit", orchestratorReminder(state, spec));
  }
  if (role === "superseded") {
    return contextOutput(
      "UserPromptSubmit",
      supersededReminder(orchestrators.current?.claimedAt),
    );
  }
  const launched = findLaunchedOrder(state, prompt);
  if (launched.problem !== undefined) {
    return contextOutput(
      "UserPromptSubmit",
      `[project-navigator] ${launched.problem}`,
    );
  }
  if (
    launched.order !== undefined &&
    registerExecutor({
      worktreeRoot: projectRoot,
      sessionId,
      order: launched.order,
      now,
    })
  ) {
    return contextOutput(
      "UserPromptSubmit",
      executorReminder(readExecutorRecord(projectRoot, sessionId)),
    );
  }
  if (role !== "executor") {
    return undefined;
  }
  const record = readExecutorRecord(projectRoot, sessionId);
  if (record === undefined || !record.isAwaitingAlignment) {
    return undefined;
  }
  const answered = applyAlignmentAnswer(record, state, prompt, spec);
  writeExecutorRecord(projectRoot, answered);
  return contextOutput("UserPromptSubmit", executorReminder(answered));
}

/**
 * 处理会话开始事件 (含恢复与上下文压缩后): 注入身份与位置提醒.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleSessionStart({
  projectRoot,
  state,
  orchestrators,
  role,
  sessionId,
}) {
  switch (role) {
    case "orchestrator":
      return contextOutput(
        "SessionStart",
        orchestratorResumeReminder(state, loadSpec()),
      );
    case "superseded":
      return contextOutput(
        "SessionStart",
        supersededReminder(orchestrators.current?.claimedAt),
      );
    case "executor": {
      const record = readExecutorRecord(projectRoot, sessionId);
      return record === undefined
        ? undefined
        : contextOutput("SessionStart", executorReminder(record));
    }
    default:
      return undefined;
  }
}

/**
 * 处理回复结束事件: 校验回复版式, 不合格时打回一次.
 *
 * `stop_hook_active` 为 true 表示本轮已被打回过, 此时直接放行, 避免循环;
 * 有后台任务时回复是等待中的中间回复, 不做校验.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleStop(event) {
  const { input, role } = event;
  if (role !== "orchestrator" && role !== "executor") {
    return undefined;
  }
  const text =
    typeof input.last_assistant_message === "string"
      ? input.last_assistant_message
      : "";
  const hasBackgroundTasks =
    Array.isArray(input.background_tasks) && input.background_tasks.length > 0;
  const shouldCheck =
    text !== "" && input.stop_hook_active !== true && !hasBackgroundTasks;
  const problems =
    role === "orchestrator"
      ? orchestratorReplyProblems(event, text, shouldCheck)
      : executorReplyProblems(event, text, shouldCheck);
  if (problems.length === 0) {
    return undefined;
  }
  return {
    decision: "block",
    reason: [
      REPLY_REJECTION_HEADER,
      ...problems.map((problem, index) => `${index + 1}. ${problem}`),
    ].join("\n"),
  };
}

/**
 * 校验编排会话的回复: 版式, 摘录工单内容的节与工单文件一致, 问题级别的写作规则
 * (摘录的工单内容不查). 正在提交时不校验. 工单审阅合格, 或本轮不校验 (已被打回
 * 过一次) 时, 开始等待用户对工单审阅的选择.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @param {string} text 回复全文.
 * @param {boolean} shouldCheck 本轮是否校验版式.
 * @returns {string[]} 问题列表.
 */
function orchestratorReplyProblems(
  { projectRoot, state, now },
  text,
  shouldCheck,
) {
  if (state.order?.status === COMMITTING_STATUS) {
    return [];
  }
  const spec = loadSpec();
  const title = locateReply(text).heading?.text;
  const reply = title === undefined ? undefined : findReply(spec, title);
  const problems = shouldCheck
    ? orchestratorLayoutProblems({ text, reply, spec, projectRoot, state })
    : [];
  if (
    problems.length === 0 &&
    title === APPROVAL_REPLY_TYPE &&
    state.order !== null
  ) {
    markAwaitingApproval(projectRoot, state.order, now);
  }
  return problems;
}

/**
 * 列出编排会话回复的版式与写作问题.
 *
 * @param {object} options 参数.
 * @param {string} options.text 回复全文.
 * @param {import("./lib/spec.mjs").ReplySpec | undefined} options.reply 回复类型的规格; 标题不是回复类型时为 undefined.
 * @param {import("./lib/spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("./lib/state.mjs").NavigatorState} options.state 当前状态.
 * @returns {string[]} 问题列表.
 */
function orchestratorLayoutProblems({ text, reply, spec, projectRoot, state }) {
  const layout = checkReply({ text, spec, state, role: "orchestrator" });
  const excerpt = reply !== undefined && hasOrderExcerpt(reply);
  const orderText =
    excerpt && state.order !== null
      ? readOrderText(projectRoot, state.order)
      : undefined;
  const excerptProblems =
    orderText === undefined
      ? []
      : checkOrderExcerpt({ text, reply, orderText });
  const writing = checkWriting({
    text: excerpt ? blankOrderExcerpt(text, reply) : text,
    spec,
    maxLines: undefined,
  })
    .filter((finding) => finding.severity === "problem")
    .slice(0, MAX_WRITING_PROBLEMS)
    .map(formatFinding);
  return [...layout, ...excerptProblems, ...writing];
}

/**
 * 校验执行会话的回复: 只校验一级标题为执行会话回复类型的回复. 开工对齐合格,
 * 或本轮不校验 (已被打回过一次) 时, 记录为正在等待用户选择.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @param {string} text 回复全文.
 * @param {boolean} shouldCheck 本轮是否校验版式.
 * @returns {string[]} 问题列表.
 */
function executorReplyProblems(
  { projectRoot, state, sessionId },
  text,
  shouldCheck,
) {
  const spec = loadSpec();
  const title = locateReply(text).heading?.text;
  if (title === undefined || findReply(spec, title)?.role !== "executor") {
    return [];
  }
  const problems = shouldCheck
    ? checkReply({ text, spec, state, role: "executor" })
    : [];
  const record = readExecutorRecord(projectRoot, sessionId);
  if (
    problems.length === 0 &&
    title === ALIGNMENT_REPLY_TYPE &&
    record !== undefined
  ) {
    writeExecutorRecord(projectRoot, {
      ...record,
      isAligned: false,
      isAwaitingAlignment: true,
    });
  }
  return problems;
}

/**
 * 读取项目内文件的当前内容.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} relativePath 项目相对路径.
 * @returns {string | undefined} 文件内容; 不存在时为 undefined.
 */
function readProjectFile(projectRoot, relativePath) {
  const file = path.join(projectRoot, relativePath);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
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
