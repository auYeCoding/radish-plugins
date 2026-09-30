/**
 * @file 所有 hook 事件的统一入口, 由项目 `.claude/settings.json` 以
 * `node <本文件>` 调用, 从标准输入读取事件 JSON.
 *
 * - 工具调用前: 按会话身份判定放行或拒绝; 探测写入时留下自检心跳.
 * - 工具调用后: 状态目录中的文件被写入后, 为这个文件留下待并入快照的标记; 读取
 *   当前工单文件的会话登记为执行会话.
 * - 用户发消息, 会话开始与回复结束时: 先把待并入的写入并入快照. 这些时刻同一次
 *   工具调用的其它 hook (例如格式化) 都已结束, 快照拍到的是最终内容.
 * - 用户发消息时: 编排会话注入位置与禁令 (编排地址未登记时附登记做法), 记下消息
 *   原文供核对用户测试输出, 并记下用户对工单审阅的选择; 被接管的原编排会话注入身份提醒; 识别启动提示词并登记
 *   执行会话; 识别用户对开工对齐的选择; 工单已发布时, 从执行会话分叉出的会话
 *   沿用执行登记 (会话开始事件的兜底).
 * - 会话开始时 (含恢复, 分叉与上下文压缩后): 注入身份与位置提醒; 从当前编排会话
 *   分叉出的会话 (编号已改变) 自动接管编排, 从执行会话分叉出的会话沿用执行登记.
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
import { readSettledState } from "./lib/commit-settlement.mjs";
import { isCommitInProgress, isStageCommitting } from "./lib/commit-step.mjs";
import {
  ALIGNMENT_REPLY_TYPE,
  applyAlignmentAnswer,
  executorGuardState,
  findExecutorOrigin,
  findLaunchedOrder,
  hasExecutableOrder,
  inheritExecutor,
  orderReadBy,
  registerExecutor,
} from "./lib/executors.mjs";
import {
  blankFreeformSections,
  hasFreeformSection,
} from "./lib/freeform-sections.mjs";
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
import { flushPendingWrites, markPendingWrite } from "./lib/pending-writes.mjs";
import { headCommit, listUncommittedPaths } from "./lib/repo.mjs";
import {
  appendPrompt,
  readExecutorRecord,
  readRecentPrompts,
  writeExecutorRecord,
  writeProbeHeartbeat,
} from "./lib/registry.mjs";
import {
  executorForkReminder,
  executorReminder,
  orchestratorReminder,
  orchestratorResumeReminder,
} from "./lib/reminders.mjs";
import { checkReply, locateReply } from "./lib/reply-checks.mjs";
import { criteriaTableSpec } from "./lib/review-record.mjs";
import {
  ADDRESS_REGISTRATION_STEP,
  forkClaimReminder,
  supersededReminder,
} from "./lib/session-notices.mjs";
import {
  claimOrchestratorSession,
  findForkOrigin,
  hasOrchestratorAddress,
  identifyRole,
  orchestratorMarker,
  readOrchestrators,
} from "./lib/sessions.mjs";
import { findReply, lastStageNumber, loadSpec } from "./lib/spec.mjs";
import { INIT_UNINSTALLED } from "./lib/state.mjs";
import { COMMITTED_PATHSPECS } from "./lib/tracked-paths.mjs";
import { isProjectFinished } from "./lib/workflow-plan.mjs";
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
 * 读取文件的工具名.
 * @type {string}
 */
const READ_TOOL = "Read";

/**
 * 会话开始事件中表示分叉出新会话的来源值, 例如桌面应用回退消息, 或 `--fork-session`.
 * @type {string}
 */
const FORK_SOURCE = "fork";

/**
 * 会话开始事件中表示恢复原会话的来源值, 会话编号不变.
 * @type {string}
 */
const RESUME_SOURCE = "resume";

/**
 * 先并入待并入快照的写入再处理的事件: 这些事件发生时, 此前工具调用的全部
 * hook 都已结束. 工具调用前后的事件不并入, 以免拍到格式化之前的内容.
 * @type {readonly string[]}
 */
const FLUSH_EVENTS = Object.freeze([
  "UserPromptSubmit",
  "SessionStart",
  "Stop",
]);

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
    const now = new Date().toISOString();
    if (
      FLUSH_EVENTS.includes(String(input.hook_event_name ?? "")) &&
      state.pendingAnomaly === undefined
    ) {
      flushPendingWrites(projectRoot, { now, head: headCommit(projectRoot) });
    }
    const output = handleEvent({
      input,
      projectRoot,
      state,
      orchestrators,
      role,
      sessionId,
      now,
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
 * 读取状态文件并按提交结算记录结算, 提交完成之后守卫不再放行提交; 文件损坏时
 * 返回 undefined, 此时 hook 不做任何限制, 让恢复命令能够运行.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {import("./lib/state.mjs").NavigatorState | undefined} 状态.
 */
function readStateOrUndefined(projectRoot) {
  try {
    return readSettledState(projectRoot);
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
 * 读取会话的转录.
 *
 * @param {unknown} transcriptPath hook 输入中的转录路径.
 * @returns {string | undefined} 转录全文; 路径缺失或文件不存在时为 undefined.
 */
function readTranscript(transcriptPath) {
  if (typeof transcriptPath !== "string" || !existsSync(transcriptPath)) {
    return undefined;
  }
  return readFileSync(transcriptPath, "utf8");
}

/**
 * 按转录中的执行会话标记, 让分叉出的会话沿用原执行登记. 转录来自编排会话
 * (当前或曾经) 时不沿用, 由编排会话的分叉接管处理.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @param {string} transcript 转录全文.
 * @returns {import("./lib/registry.mjs").ExecutorRecord | undefined} 沿用后的执行登记; 没有沿用时为 undefined.
 */
function inheritFromTranscript(
  { projectRoot, orchestrators, sessionId, now },
  transcript,
) {
  if (findForkOrigin(transcript, orchestrators) !== undefined) {
    return undefined;
  }
  const origin = findExecutorOrigin(transcript);
  return origin === undefined
    ? undefined
    : inheritExecutor({ worktreeRoot: projectRoot, sessionId, origin, now });
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
      isStageCommitting: isStageCommitting(state),
      isProjectFinished:
        isProjectFinished(state, lastStageNumber(spec)) &&
        (state.stageCommit ?? null) === null,
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
    hasUncommittedRecords: () =>
      listUncommittedPaths(projectRoot, COMMITTED_PATHSPECS).length > 0,
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
 * 处理工具调用后事件: 状态目录中的文件被写入后, 为这个文件留下待并入快照的标记
 * (对账异常尚未处理时不标记); 其它会话读取当前工单文件时, 登记为执行会话
 * (启动提示词没有被识别时的兜底).
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
      markPendingWrite(projectRoot, relative);
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
 * 启动提示词把会话登记为执行会话. 工单已发布时, 其它会话再按转录中的执行会话
 * 标记沿用执行登记: 分叉出的会话不一定触发会话开始事件, 这里兜底.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleUserPrompt(event) {
  const { input, projectRoot, state, orchestrators, role, sessionId, now } =
    event;
  const prompt = String(input.prompt ?? "");
  const spec = loadSpec();
  if (role === "orchestrator") {
    appendPrompt(projectRoot, prompt, now);
    applyApprovalAnswer({ projectRoot, order: state.order, prompt, spec, now });
    return contextOutput(
      "UserPromptSubmit",
      orchestratorReminder({
        state,
        spec,
        isAddressRegistered: hasOrchestratorAddress(orchestrators),
      }),
    );
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
  if (role === "other") {
    return inheritedPromptOutput(event);
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
 * 其它会话收到消息时, 按转录中的执行会话标记沿用执行登记. 只在工单已发布时
 * 读取转录, 避免与执行无关的会话每条消息都读一次.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function inheritedPromptOutput(event) {
  const transcript = hasExecutableOrder(event.state)
    ? readTranscript(event.input.transcript_path)
    : undefined;
  const inherited =
    transcript === undefined
      ? undefined
      : inheritFromTranscript(event, transcript);
  return inherited === undefined
    ? undefined
    : contextOutput("UserPromptSubmit", executorForkReminder(inherited));
}

/**
 * 处理会话开始事件 (含恢复, 分叉与上下文压缩后): 注入身份与位置提醒. 编排会话
 * 恢复后另外提醒重新登记编排地址. 分叉出的会话编号已改变, 先从转录认出来源:
 * 来自当前编排会话时自动接管编排; 来自执行会话时沿用原执行登记.
 *
 * @param {HookEvent} event hook 调用上下文.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON.
 */
function handleSessionStart(event) {
  const { input, projectRoot, state, orchestrators, role, sessionId, now } =
    event;
  const transcript =
    role === "other" && input.source === FORK_SOURCE
      ? readTranscript(input.transcript_path)
      : undefined;
  const origin =
    transcript === undefined
      ? undefined
      : findForkOrigin(transcript, orchestrators);
  if (origin === "current") {
    claimOrchestratorSession(projectRoot, sessionId, now);
    return contextOutput(
      "SessionStart",
      forkClaimReminder(orchestratorMarker(sessionId)),
    );
  }
  const inherited =
    transcript === undefined
      ? undefined
      : inheritFromTranscript(event, transcript);
  if (inherited !== undefined) {
    return contextOutput("SessionStart", executorForkReminder(inherited));
  }
  switch (origin === "former" ? "superseded" : role) {
    case "orchestrator": {
      const isAddressRegistered = hasOrchestratorAddress(orchestrators);
      return contextOutput(
        "SessionStart",
        [
          orchestratorResumeReminder({
            state,
            spec: loadSpec(),
            isAddressRegistered,
          }),
          ...(input.source === RESUME_SOURCE && isAddressRegistered
            ? [`会话刚恢复, 编排地址可能已改变: ${ADDRESS_REGISTRATION_STEP}.`]
            : []),
        ].join("\n"),
      );
    }
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
  if (isCommitInProgress(state)) {
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
 * 列出编排会话回复的版式与写作问题. 摘录的工单内容与自由正文不按写作规则检查.
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
  const authored = excerpt ? blankOrderExcerpt(text, reply) : text;
  const writing = checkWriting({
    text:
      reply !== undefined && hasFreeformSection(reply)
        ? blankFreeformSections(authored, reply)
        : authored,
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
