/**
 * @file 工单往返的端到端测试: 在临时仓库中用项目内的命令行与 hook 走完
 * 路线 → 工单 → 工单审阅 → 执行会话登记与对齐 → 回执 → 验收 → 提交, 以及撤回修改,
 * 回退记录, 对账异常与体检.
 *
 * 记录文件都按会话的真实做法写入: 先经过 hook 的写入守卫, 写入后再触发工具调用后
 * 事件, 让快照并入这个文件. 直接写文件而不经过 hook 相当于其它程序改动了记录.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PLACEHOLDER } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import {
  PLUGIN_COMMAND,
  commitPaths,
  createTemporaryRepository,
  initializeProject,
  commandSkeleton,
  runCommand,
  runGit,
} from "./helpers.mjs";

/**
 * 编排会话编号.
 * @type {string}
 */
const ORCHESTRATOR = "session-orchestrator";

/**
 * 执行会话编号.
 * @type {string}
 */
const EXECUTOR = "session-executor";

/**
 * 填写骨架中占位符时使用的文字.
 * @type {string}
 */
const FILLER = "已填写的内容";

/**
 * 验收记录骨架中等用户选择后才写的键的预填值.
 * @type {string}
 */
const DEFERRED_PRESET = "待用户确认";

/**
 * 测试用的代码检查命令.
 * @type {string}
 */
const CODE_CHECK_COMMAND = "npm run lint";

/**
 * 测试用的取证工具.
 * @type {string}
 */
const EVIDENCE_TOOL = "mcp__Reqable__capture_live_filter";

/**
 * 第一张实现工单的文件夹, 相对于项目根目录.
 * @type {string}
 */
const FIRST_ORDER_FOLDER = ".navigator/orders/0001-export-csv";

/**
 * 推进路线草稿.
 * @type {Readonly<Record<string, unknown>>}
 */
const ROADMAP_DRAFT = Object.freeze({
  milestones: [
    {
      name: "导出报表",
      goal: "能导出月报",
      metrics: ["导出成功"],
      slices: [{ name: "导出 CSV" }],
    },
  ],
});

/**
 * @typedef {object} FlowContext 已初始化的临时项目.
 * @property {string} root 项目根目录.
 * @property {(args: readonly string[]) => {status: number | null, stdout: string}} project 调用项目内命令行.
 * @property {(input: Record<string, unknown>) => {status: number | null, output: any}} hook 调用项目内 hook.
 */

/**
 * 把骨架中的占位符替换为内容.
 *
 * @param {string} text 骨架.
 * @returns {string} 填好的文本.
 */
function fill(text) {
  return text.split(PLACEHOLDER).join(FILLER);
}

/**
 * 按会话的真实做法写入一个文件: 经过写入守卫, 写入, 再触发工具调用后事件.
 *
 * @param {FlowContext} context 测试上下文.
 * @param {string} sessionId 写入的会话.
 * @param {string} relativePath 目标文件, 相对于项目根目录.
 * @param {string} content 文件内容.
 * @returns {void}
 */
function writeThroughHook({ root, hook }, sessionId, relativePath, content) {
  const file = path.join(root, relativePath);
  const decision = hook({
    session_id: sessionId,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: file, content },
  });
  assert.equal(
    decision.output,
    undefined,
    decision.output?.hookSpecificOutput?.permissionDecisionReason,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  hook({
    session_id: sessionId,
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: file },
  });
}

/**
 * 按骨架写入验收记录, 判据核对只有一行, 结论为指定值. 默认也写下用户结论与
 * 提交方式, 相当于用户已经作出选择.
 *
 * @param {FlowContext} context 测试上下文.
 * @param {string} folder 工单文件夹, 相对于项目根目录.
 * @param {string} verdict 判据结论.
 * @param {{isDecided?: boolean}} [options] 是否写下用户的选择; 为 false 时保留骨架预填的值.
 * @returns {void}
 */
function writeReview(context, folder, verdict, { isDecided = true } = {}) {
  const skeleton = fill(
    commandSkeleton(context.project(["template", "review"]).stdout),
  ).replace(
    `| ${FILLER} | ${FILLER} | ${FILLER} |`,
    `| ${FILLER} | ${verdict} | ${FILLER} |`,
  );
  const text = isDecided
    ? skeleton.replaceAll(DEFERRED_PRESET, FILLER)
    : skeleton;
  writeThroughHook(context, ORCHESTRATOR, `${folder}/review.md`, text);
}

/**
 * 列出状态目录中相对 HEAD 尚未入库的改动, 格式同 `git status --porcelain`.
 *
 * @param {string} root 项目根目录.
 * @returns {string} 改动列表; 工作区干净时为空字符串.
 */
function uncommittedRecords(root) {
  return runGit(root, ["status", "--porcelain", "--", ".navigator"]);
}

/**
 * 编排会话调用提交技能时守卫的拒绝理由; 放行时为 undefined.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {string | undefined} 拒绝理由.
 */
function commitSkillDenial({ hook }) {
  return hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "PreToolUse",
    tool_name: "Skill",
    tool_input: { skill: "waypoint:commit-message" },
  }).output?.hookSpecificOutput?.permissionDecisionReason;
}

/**
 * 写入草稿文件并返回其相对路径. 草稿不纳入快照, 直接写入.
 *
 * @param {string} root 项目根目录.
 * @param {string} name 草稿文件名.
 * @param {unknown} content 草稿内容.
 * @returns {string} 相对于项目根目录的路径.
 */
function writeDraft(root, name, content) {
  const relative = `.navigator/drafts/${name}`;
  mkdirSync(path.join(root, ".navigator", "drafts"), { recursive: true });
  writeFileSync(path.join(root, relative), JSON.stringify(content), "utf8");
  return relative;
}

/**
 * 在已初始化的临时项目中运行测试.
 *
 * @param {string} name 测试名.
 * @param {(context: FlowContext) => void} body 测试内容.
 * @returns {void}
 */
function projectTest(name, body) {
  test(name, () => {
    const repository = createTemporaryRepository();
    try {
      const tools = initializeProject(repository.root, ORCHESTRATOR);
      body({ root: repository.root, ...tools });
    } finally {
      repository.cleanup();
    }
  });
}

/**
 * 登记代码检查命令.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {void}
 */
function registerCodeCheck({ root, project }) {
  const draft = writeDraft(root, "codecheck.json", {
    commands: [CODE_CHECK_COMMAND],
  });
  const result = project(["codecheck", "set", "--from", draft]);
  assert.equal(result.status, 0, result.stdout);
}

/**
 * 建立推进路线, 进入第一个切片, 新建第一张实现工单并写好工单文件.
 *
 * @param {FlowContext} context 测试上下文.
 * @param {(text: string) => string} [edit] 写入前对工单内容的修改.
 * @returns {string} 工单文件夹, 相对于项目根目录.
 */
function draftFirstOrder(context, edit = (text) => text) {
  const { root, project } = context;
  assert.equal(project(["stage", "5"]).status, 0);
  const draft = writeDraft(root, "roadmap.json", ROADMAP_DRAFT);
  assert.equal(project(["roadmap", "--from", draft]).status, 0);
  assert.equal(project(["slice", "0001", "active"]).status, 0);
  registerCodeCheck(context);
  const created = project([
    "order",
    "new",
    "--kind",
    "implementation",
    "--slug",
    "export-csv",
    "--slice",
    "0001",
  ]);
  assert.equal(created.status, 0, created.stdout);
  writeOrder(context, FIRST_ORDER_FOLDER, edit);
  return FIRST_ORDER_FOLDER;
}

/**
 * 按骨架写入当前工单的工单文件.
 *
 * @param {FlowContext} context 测试上下文.
 * @param {string} folder 工单文件夹, 相对于项目根目录.
 * @param {(text: string) => string} [edit] 写入前对工单内容的修改.
 * @returns {void}
 */
function writeOrder(context, folder, edit = (text) => text) {
  writeThroughHook(
    context,
    ORCHESTRATOR,
    `${folder}/order.md`,
    edit(fill(commandSkeleton(context.project(["template", "order"]).stdout))),
  );
}

/**
 * 编排会话回复 "工单审阅", 返回填好的回复.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {string} 回复全文.
 */
function replyApproval({ project, hook }) {
  const skeleton = project(["reply", "approve"]);
  assert.equal(skeleton.status, 0, skeleton.stdout);
  const reply = fill(commandSkeleton(skeleton.stdout));
  assert.equal(
    hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "Stop",
      last_assistant_message: reply,
    }).output,
    undefined,
    "按骨架填写的工单审阅合格",
  );
  return reply;
}

/**
 * 用户在编排会话中发一条消息.
 *
 * @param {FlowContext} context 测试上下文.
 * @param {string} prompt 消息原文.
 * @returns {void}
 */
function userSays({ hook }, prompt) {
  hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "UserPromptSubmit",
    prompt,
  });
}

/**
 * 请用户审阅当前工单, 用户选 A, 然后发布.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {void}
 */
function approveAndIssue(context) {
  replyApproval(context);
  userSays(context, "A");
  const issued = context.project(["order", "set", "issued"]);
  assert.equal(issued.status, 0, issued.stdout);
}

/**
 * 建立推进路线, 写好并审阅第一张工单, 然后发布.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {string} 工单文件夹, 相对于项目根目录.
 */
function issueFirstOrder(context) {
  const folder = draftFirstOrder(context);
  approveAndIssue(context);
  return folder;
}

/**
 * 从工单发布的回复骨架中取出启动提示词.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {string} 启动提示词.
 */
function launchPrompt({ project }) {
  const prompt = /```markdown\n([\s\S]*?)\n```/u.exec(
    project(["reply", "order"]).stdout,
  )?.[1];
  assert.ok(prompt !== undefined);
  return prompt;
}

/**
 * 执行会话写业务文件, 返回守卫的拒绝理由; 放行时为 undefined.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {string | undefined} 拒绝理由.
 */
function executorWritesBusinessFile({ root, hook }) {
  return hook({
    session_id: EXECUTOR,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "app.js"), content: "" },
  }).output?.hookSpecificOutput?.permissionDecisionReason;
}

/**
 * 执行会话回复开工对齐, 用户选 A.
 *
 * @param {FlowContext} context 测试上下文.
 * @returns {string} 用户选 A 后注入执行会话的提醒.
 */
function alignExecutor({ project, hook }) {
  const alignment = fill(commandSkeleton(project(["reply", "align"]).stdout));
  assert.equal(
    hook({
      session_id: EXECUTOR,
      hook_event_name: "Stop",
      last_assistant_message: alignment,
    }).output,
    undefined,
  );
  return hook({
    session_id: EXECUTOR,
    hook_event_name: "UserPromptSubmit",
    prompt: "A",
  }).output.hookSpecificOutput.additionalContext;
}

/**
 * 把若干条注入的提醒写成转录文件, 模拟分叉出的会话复制的历史.
 *
 * @param {string} root 项目根目录.
 * @param {string} name 文件名.
 * @param {readonly string[]} contexts 按先后排列的提醒.
 * @returns {string} 转录文件的绝对路径.
 */
function writeTranscript(root, name, contexts) {
  const file = path.join(root, name);
  writeFileSync(
    file,
    contexts
      .map((content) =>
        JSON.stringify({
          type: "attachment",
          attachment: { type: "hook_additional_context", content: [content] },
        }),
      )
      .join("\n"),
    "utf8",
  );
  return file;
}

projectTest("流程: 路线与工单发布, 回复骨架带启动提示词", (context) => {
  const { root, project, hook } = context;
  issueFirstOrder(context);
  assert.ok(existsSync(path.join(root, ".navigator", "plan", "roadmap.md")));
  const reply = commandSkeleton(project(["reply", "order"]).stdout);
  assert.match(reply, /^```markdown$/mu);
  assert.match(reply, /执行工单 0001\./u);
  const accepted = hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "Stop",
    last_assistant_message: fill(reply),
  });
  assert.equal(accepted.output, undefined, "填好的工单发布回复合格");
  const rejected = hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "Stop",
    last_assistant_message: fill(reply).replace(
      "- 任务目标: 已填写的内容",
      "- 任务目标: 本工单可以赋能团队",
    ),
  });
  assert.equal(rejected.output.decision, "block");
  assert.match(rejected.output.reason, /黑话/u);
  const retried = hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "Stop",
    stop_hook_active: true,
    last_assistant_message: "随便写写",
  });
  assert.equal(retried.output, undefined, "已打回过一次时放行");
});

projectTest(
  "流程: 工单发布前必须经用户审阅, 审阅绑定工单内容, 每次发布都要重新审阅",
  (context) => {
    const { project, hook } = context;
    draftFirstOrder(context, (text) =>
      text.replace(
        `## 执行守则\n\n${FILLER}`,
        "## 执行守则\n\n本工单可以赋能团队.",
      ),
    );
    assert.match(
      project(["status"]).stdout,
      /回复 "工单审阅" \(reply approve\), 请用户审阅/u,
    );
    const unreviewed = project(["order", "set", "issued"]);
    assert.equal(unreviewed.status, 1);
    assert.match(unreviewed.stdout, /还没有经用户审阅/u);

    const skeleton = commandSkeleton(project(["reply", "approve"]).stdout);
    assert.match(
      skeleton,
      /^- 文件路径: \.navigator\/orders\/0001-export-csv\/order\.md$/mu,
    );
    assert.match(skeleton, /本工单可以赋能团队\./u, "骨架摘录工单原文");
    assert.match(skeleton, /代码检查通过: 运行 `npm run lint`/u);
    const tampered = hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "Stop",
      last_assistant_message: fill(skeleton).replace(
        "本工单可以赋能团队.",
        "本工单改动很小.",
      ),
    });
    assert.equal(tampered.output.decision, "block");
    assert.match(tampered.output.reason, /必须与工单文件中的同名一节一致/u);
    assert.doesNotMatch(
      tampered.output.reason,
      /黑话/u,
      "摘录的工单内容不按回复的写作规则打回",
    );

    replyApproval(context);
    assert.match(project(["status"]).stdout, /等用户在 "工单审阅" 中选择/u);
    assert.match(project(["order", "set", "issued"]).stdout, /正在等用户审阅/u);
    userSays(context, "B 判据 2 写得不清楚");
    assert.match(project(["status"]).stdout, /请用户审阅/u, "选 B 撤销等待");

    replyApproval(context);
    userSays(context, "A");
    writeOrder(context, FIRST_ORDER_FOLDER, (text) =>
      text.replace("本工单可以赋能团队.", "只改导出模块."),
    );
    const changed = project(["order", "set", "issued"]);
    assert.equal(changed.status, 1, "审阅之后内容有改动时不能发布");
    assert.match(changed.stdout, /审阅之后内容有改动/u);

    replyApproval(context);
    userSays(context, "内容无误, 发布吧");
    assert.match(
      project(["status"]).stdout,
      /已经用户审阅: 运行 order set issued/u,
    );
    assert.equal(project(["order", "set", "issued"]).status, 0);
    assert.equal(project(["order", "set", "blocked"]).status, 0);
    const reissue = project(["order", "set", "issued"]);
    assert.equal(reissue.status, 1, "认可在发布时用掉, 重新发布要重新审阅");
    assert.match(reissue.stdout, /还没有经用户审阅/u);
  },
);

projectTest("流程: 工单文件没写好或不能发布时, 不能请用户审阅", (context) => {
  const { root, project } = context;
  assert.equal(project(["reply", "approve"]).status, 1, "没有工单时不能审阅");
  assert.equal(project(["stage", "5"]).status, 0);
  const draft = writeDraft(root, "roadmap.json", ROADMAP_DRAFT);
  assert.equal(project(["roadmap", "--from", draft]).status, 0);
  assert.equal(
    project(["order", "new", "--kind", "implementation", "--slug", "x"]).status,
    0,
  );
  const missing = project(["reply", "approve"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /还没有写入/u);
  writeOrder(context, ".navigator/orders/0001-x");
  const unregistered = project(["reply", "approve"]);
  assert.equal(unregistered.status, 1);
  assert.match(unregistered.stdout, /codecheck set/u);
});

projectTest("流程: 发布后等待回执, 回执写入后转为读回执", (context) => {
  const { project, hook } = context;
  const folder = issueFirstOrder(context);
  assert.match(project(["status"]).stdout, /回复 "等待回执" \(reply wait\)/u);
  const reply = fill(commandSkeleton(project(["reply", "wait"]).stdout));
  assert.match(reply, /^\[回执到位\]$/mu);
  const accepted = hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "Stop",
    last_assistant_message: reply,
  });
  assert.equal(accepted.output, undefined, "填好的等待回执回复合格");
  writeThroughHook(
    context,
    ORCHESTRATOR,
    `${folder}/receipt.md`,
    fill(commandSkeleton(project(["template", "receipt"]).stdout)),
  );
  assert.match(project(["status"]).stdout, /工单 0001 已有回执/u);
});

projectTest("流程: 执行会话登记, 对齐, 回执, 验收与提交", (context) => {
  const { root, project, hook } = context;
  const folder = issueFirstOrder(context);
  const registered = hook({
    session_id: EXECUTOR,
    hook_event_name: "UserPromptSubmit",
    prompt: launchPrompt(context),
  });
  assert.match(
    registered.output.hookSpecificOutput.additionalContext,
    /工单 0001 的执行会话/u,
  );
  assert.match(
    executorWritesBusinessFile(context) ?? "",
    /开工对齐尚未完成/u,
    "对齐之前不能写业务文件",
  );
  alignExecutor(context);
  assert.equal(
    executorWritesBusinessFile(context),
    undefined,
    "对齐之后可以写业务文件",
  );
  const commit = hook({
    session_id: EXECUTOR,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git commit -m x" },
  });
  assert.equal(commit.output.hookSpecificOutput.permissionDecision, "deny");

  writeThroughHook(
    context,
    EXECUTOR,
    `${folder}/receipt.md`,
    fill(commandSkeleton(project(["template", "receipt"]).stdout)),
  );
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.js"), "export {};\n", "utf8");

  const status = project(["status"]).stdout;
  assert.match(status, /回执已写入/u);
  assert.match(status, /已有回执/u);
  assert.match(status, /对账结果: 一致/u, "执行会话写回执后并入了快照");

  assert.equal(project(["order", "set", "reviewing"]).status, 0);
  const brief = project(["review-brief"]).stdout;
  assert.equal(
    hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: {
        subagent_type: "waypoint:navigator-reviewer",
        prompt: brief,
      },
    }).output,
    undefined,
  );
  assert.ok(
    executorWritesBusinessFile(context) !== undefined,
    "验收中执行会话不能再改业务文件",
  );
  writeReview(context, folder, "通过");
  assert.equal(project(["order", "set", "accepted"]).status, 0);
  assert.equal(
    hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "PreToolUse",
      tool_name: "Skill",
      tool_input: { skill: "waypoint:commit-message" },
    }).output,
    undefined,
  );
  assert.equal(project(["order", "set", "committing"]).status, 0);
  commitPaths(root, [".navigator", "src"], "feat: 导出 CSV");
  const incomplete = project(["order", "set", "committed"]);
  assert.equal(incomplete.status, 1, "项目配置漏提交时不能收尾");
  assert.match(incomplete.stdout, /\.claude\/settings\.json/u);
  const head = commitPaths(root, [".claude/settings.json"], "chore: 补交配置");
  assert.equal(project(["order", "set", "committed"]).status, 0);
  assert.equal(uncommittedRecords(root), "", "提交完成后不改写状态文件");
  assert.ok(
    commitSkillDenial(context) !== undefined,
    "提交完成后不再放行提交技能",
  );
  const after = project(["status"]).stdout;
  assert.match(after, /对账结果: 一致/u);
  assert.match(after, new RegExp(`记录提交: ${head.slice(0, 7)}`, "u"));
  assert.match(after, /当前工单: 无 \(上一张 0001 已结束, committed\)/u);
  assert.equal(project(["slice", "0001", "done"]).status, 0);
  const saved = JSON.parse(
    readFileSync(path.join(root, ".navigator", "state.json"), "utf8"),
  );
  assert.equal(saved.lastCommit, head, "下一次写入带上结算后的状态");
  assert.equal(saved.order, null);
});

projectTest(
  "流程: 已发布的工单撤回修改后重新发布, 执行会话要重新对齐",
  (context) => {
    const { project, hook } = context;
    issueFirstOrder(context);
    hook({
      session_id: EXECUTOR,
      hook_event_name: "UserPromptSubmit",
      prompt: launchPrompt(context),
    });
    alignExecutor(context);
    assert.equal(executorWritesBusinessFile(context), undefined);
    assert.equal(project(["order", "set", "drafting"]).status, 0);
    assert.match(
      executorWritesBusinessFile(context) ?? "",
      /撤回修改/u,
      "撤回之后执行会话不能再写文件",
    );
    writeOrder(context, FIRST_ORDER_FOLDER, (text) =>
      text.replace(
        `## 前提假设\n\n${FILLER}`,
        "## 前提假设\n\n导出模块已存在.",
      ),
    );
    approveAndIssue(context);
    assert.match(
      executorWritesBusinessFile(context) ?? "",
      /开工对齐尚未完成/u,
      "重新发布后要就新一轮重新对齐",
    );
    alignExecutor(context);
    assert.equal(executorWritesBusinessFile(context), undefined);
  },
);

projectTest(
  "流程: 开工对齐前有一句过程说明时, 用户选 A 后可以写业务文件",
  (context) => {
    const { project, hook } = context;
    issueFirstOrder(context);
    hook({
      session_id: EXECUTOR,
      hook_event_name: "UserPromptSubmit",
      prompt: launchPrompt(context),
    });
    const alignment = `对账相符, 计划已做完, 下面是开工对齐.\n\n---\n\n${fill(commandSkeleton(project(["reply", "align"]).stdout))}`;
    assert.equal(
      hook({
        session_id: EXECUTOR,
        hook_event_name: "Stop",
        last_assistant_message: alignment,
      }).output,
      undefined,
      "标题前的过程说明不打回",
    );
    hook({
      session_id: EXECUTOR,
      hook_event_name: "UserPromptSubmit",
      prompt: "A",
    });
    assert.equal(
      executorWritesBusinessFile(context),
      undefined,
      "对齐已被识别, 可以写业务文件",
    );
  },
);

projectTest(
  "流程: 实现工单必须带代码检查判据, 检查命令算作已授权测试",
  (context) => {
    const { root, project, hook } = context;
    assert.equal(project(["stage", "5"]).status, 0);
    const draft = writeDraft(root, "roadmap.json", ROADMAP_DRAFT);
    assert.equal(project(["roadmap", "--from", draft]).status, 0);
    assert.equal(project(["slice", "0001", "active"]).status, 0);
    assert.equal(
      project([
        "order",
        "new",
        "--kind",
        "implementation",
        "--slug",
        "export-csv",
        "--slice",
        "0001",
      ]).status,
      0,
    );
    writeOrder(context, FIRST_ORDER_FOLDER);
    const unregistered = project(["order", "set", "issued"]);
    assert.equal(unregistered.status, 1);
    assert.match(unregistered.stdout, /codecheck set/u);
    registerCodeCheck(context);
    const missing = project(["order", "set", "issued"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /缺少代码检查判据/u);
    writeOrder(context, FIRST_ORDER_FOLDER);
    approveAndIssue(context);
    assert.equal(project(["order", "set", "reviewing"]).status, 0);
    assert.match(
      project(["review-brief"]).stdout,
      new RegExp(`已授权测试: ${CODE_CHECK_COMMAND}`, "u"),
    );
    for (const toolName of ["Bash", "PowerShell"]) {
      assert.equal(
        hook({
          session_id: ORCHESTRATOR,
          agent_id: "agent-reviewer",
          agent_type: "waypoint:navigator-reviewer",
          hook_event_name: "PreToolUse",
          tool_name: toolName,
          tool_input: { command: CODE_CHECK_COMMAND },
        }).output,
        undefined,
        `验收子代理可以用 ${toolName} 运行代码检查`,
      );
    }
  },
);

projectTest(
  "流程: 判据核对不全是通过时, 不能请用户人工验收, 也不能通过验收",
  (context) => {
    const { project } = context;
    const folder = issueFirstOrder(context);
    assert.equal(project(["order", "set", "reviewing"]).status, 0);
    const missing = project(["order", "set", "accepted"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /review\.md 还没有写入/u);
    writeReview(context, folder, "未验证");
    const refused = project(["order", "set", "accepted"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /结论为 "未验证"/u);
    const manual = project(["reply", "review", "--option", "1"]);
    assert.equal(manual.status, 1);
    assert.match(manual.stdout, /order set rejected/u);
    assert.equal(project(["reply", "review", "--option", "2"]).status, 0);
    writeReview(context, folder, "通过", { isDecided: false });
    assert.equal(project(["reply", "review", "--option", "1"]).status, 0);
    const undecided = project(["order", "set", "accepted"]);
    assert.equal(undecided.status, 1, "用户结论还是预填值时不能通过验收");
    assert.match(undecided.stdout, /"用户结论" 还是 "待用户确认"/u);
    writeReview(context, folder, "通过");
    assert.equal(project(["order", "set", "accepted"]).status, 0);
  },
);

projectTest(
  "流程: 取证工具登记后验收子代理可以调用, 用户测试输出逐字核对",
  (context) => {
    const { root, project, hook } = context;
    const invalid = writeDraft(root, "tools.json", {
      tools: ["mcp__Reqable__*"],
    });
    assert.equal(project(["tools", "set", "--from", invalid]).status, 1);
    const draft = writeDraft(root, "tools.json", { tools: [EVIDENCE_TOOL] });
    const registered = project(["tools", "set", "--from", draft]);
    assert.equal(registered.status, 0, registered.stdout);
    assert.match(
      registered.stdout,
      new RegExp(`取证工具: ${EVIDENCE_TOOL}`, "u"),
    );

    const folder = issueFirstOrder(context);
    assert.equal(project(["order", "set", "reviewing"]).status, 0);
    const brief = project(["review-brief"]).stdout;
    assert.match(brief, new RegExp(`已授权取证工具: ${EVIDENCE_TOOL}`, "u"));
    assert.match(brief, /用户测试记录: .+user-tests\.md/u);
    assert.match(brief, /证据文件目录: .+0001-export-csv[\\/]artifacts/u);
    const reviewerCall = (toolName) =>
      hook({
        session_id: ORCHESTRATOR,
        agent_id: "agent-reviewer",
        agent_type: "waypoint:navigator-reviewer",
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: {},
      }).output;
    assert.equal(reviewerCall(EVIDENCE_TOOL), undefined);
    assert.equal(
      reviewerCall("mcp__Reqable__capture_live_clear").hookSpecificOutput
        .permissionDecision,
      "deny",
    );

    userSays(context, "运行结果:\nHTTP/2 200\nx-mid: aZ3f");
    const userTests = (output) =>
      fill(commandSkeleton(project(["template", "user-tests"]).stdout)).replace(
        /```text/u,
        `## 测试 0001: 注册第一步\n\n- 测试命令: \`python main.py\`\n- 对应判据: 判据 2\n\n\`\`\`output\n${output}\n\`\`\`\n\n\`\`\`text`,
      );
    const writeUserTests = (output) =>
      hook({
        session_id: ORCHESTRATOR,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: path.join(root, folder, "user-tests.md"),
          content: userTests(output),
        },
      }).output;
    assert.equal(writeUserTests("HTTP/2 200\nx-mid: aZ3f"), undefined);
    assert.match(
      writeUserTests("HTTP/2 200\nx-mid: 已获取").hookSpecificOutput
        .permissionDecisionReason,
      /逐字/u,
    );

    writeReview(context, folder, "通过");
    assert.equal(project(["order", "set", "accepted"]).status, 0);
    const reminder = hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "UserPromptSubmit",
      prompt: "A",
    }).output.hookSpecificOutput.additionalContext;
    assert.match(reminder, /git commit -F -/u);
  },
);

projectTest(
  "流程: 选型工单核对证据需要回执, 不通过时下一动作是新建选型工单",
  (context) => {
    const { project } = context;
    const noOrder = project(["evidence"]);
    assert.equal(noOrder.status, 1);
    assert.match(noOrder.stdout, /当前没有选型工单/u);
    assert.equal(
      project(["order", "new", "--kind", "selection", "--slug", "transport"])
        .status,
      0,
    );
    writeOrder(context, ".navigator/orders/0001-transport");
    approveAndIssue(context);
    const noReceipt = project(["evidence"]);
    assert.equal(noReceipt.status, 1);
    assert.match(noReceipt.stdout, /还没有回执/u);
    assert.equal(project(["order", "set", "reviewing"]).status, 0);
    const rejected = project(["order", "set", "rejected"]);
    assert.equal(rejected.status, 0, rejected.stdout);
    assert.match(rejected.stdout, /order new --kind selection/u);
  },
);

projectTest(
  "流程: 读取工单文件的会话登记为执行会话, 编排会话不会被登记",
  (context) => {
    const { root, hook } = context;
    const folder = issueFirstOrder(context);
    assert.ok(
      existsSync(path.join(root, ".navigator", "guide", "executor.md")),
      "初始化时复制了执行手册",
    );
    assert.ok(
      existsSync(
        path.join(root, ".navigator", "bin", "references", "intake.md"),
      ),
      "初始化时把参考文件复制进项目, 读取时不需要用户批准",
    );
    const readOrder = (sessionId) =>
      hook({
        session_id: sessionId,
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: path.join(root, folder, "order.md") },
      });
    assert.equal(readOrder(ORCHESTRATOR).output, undefined);
    assert.match(
      readOrder(EXECUTOR).output.hookSpecificOutput.additionalContext,
      /工单 0001 的执行会话/u,
    );
    const started = hook({
      session_id: EXECUTOR,
      hook_event_name: "SessionStart",
      source: "compact",
    });
    assert.match(
      started.output.hookSpecificOutput.additionalContext,
      /未对齐/u,
    );
    const resumed = hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "SessionStart",
      source: "compact",
    });
    assert.match(
      resumed.output.hookSpecificOutput.additionalContext,
      /上下文刚被压缩/u,
    );
    const prompted = hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "UserPromptSubmit",
      prompt: "继续",
    });
    assert.match(
      prompted.output.hookSpecificOutput.additionalContext,
      /你是编排会话. 当前阶段 5\/6 \(切片\)/u,
    );
  },
);

projectTest(
  "流程: 从编排会话分叉出的会话自动接管编排, 编排地址随接管清空",
  (context) => {
    const { root, project, hook } = context;
    const entered = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", ORCHESTRATOR],
      root,
    ).stdout;
    assert.match(entered, /编排会话编号: session-orchestrator/u);
    assert.match(entered, /地址登记: /u);
    const draft = writeDraft(root, "address.json", {
      address: "编排会话 [e6b1dd]",
    });
    assert.equal(project(["address", "set", "--from", draft]).status, 0);
    assert.match(
      project(["status"]).stdout,
      /编排地址: 编排会话 \[e6b1dd\], 登记于/u,
    );

    const transcript = path.join(root, "fork-transcript.jsonl");
    writeFileSync(transcript, JSON.stringify({ content: entered }), "utf8");
    const forked = hook({
      session_id: "session-forked",
      hook_event_name: "SessionStart",
      source: "fork",
      transcript_path: transcript,
    });
    assert.match(
      forked.output.hookSpecificOutput.additionalContext,
      /已自动接管编排. 编排会话编号: session-forked/u,
    );
    assert.match(project(["status"]).stdout, /编排地址: 未登记/u);
    assert.match(
      hook({
        session_id: ORCHESTRATOR,
        hook_event_name: "UserPromptSubmit",
        prompt: "A",
      }).output.hookSpecificOutput.additionalContext,
      /已不是编排会话/u,
    );

    const stranger = hook({
      session_id: "session-stranger",
      hook_event_name: "SessionStart",
      source: "fork",
      transcript_path: path.join(root, "README.md"),
    });
    assert.equal(stranger.output, undefined, "转录中没有标记时不接管");
  },
);

projectTest(
  "流程: 编排地址未登记时, 编排会话收到消息与恢复时都得到登记提醒, 登记后不再提醒",
  (context) => {
    const { root, project, hook } = context;
    const reminderOf = (input) =>
      hook({ session_id: ORCHESTRATOR, ...input }).output.hookSpecificOutput
        .additionalContext;
    const unregistered = /编排地址尚未登记.*address set --from/u;
    assert.match(
      reminderOf({ hook_event_name: "UserPromptSubmit", prompt: "A" }),
      unregistered,
    );
    const resumedBefore = reminderOf({
      hook_event_name: "SessionStart",
      source: "resume",
    });
    assert.match(resumedBefore, unregistered);
    assert.doesNotMatch(resumedBefore, /会话刚恢复/u);

    const draft = writeDraft(root, "address.json", {
      address: "编排会话 [e6b1dd]",
    });
    assert.equal(project(["address", "set", "--from", draft]).status, 0);
    assert.doesNotMatch(
      reminderOf({ hook_event_name: "UserPromptSubmit", prompt: "A" }),
      /编排地址尚未登记/u,
    );
    assert.match(
      reminderOf({ hook_event_name: "SessionStart", source: "resume" }),
      /会话刚恢复, 编排地址可能已改变/u,
    );
  },
);

projectTest(
  "流程: 从执行会话分叉出的会话沿用执行登记, 对齐状态取分叉点时的状态",
  (context) => {
    const { root, project, hook } = context;
    const folder = issueFirstOrder(context);
    const launched = hook({
      session_id: EXECUTOR,
      hook_event_name: "UserPromptSubmit",
      prompt: launchPrompt(context),
    }).output.hookSpecificOutput.additionalContext;
    assert.match(launched, /^执行会话编号: session-executor\.$/mu);
    const aligned = alignExecutor(context);
    assert.match(
      aligned,
      /^执行会话编号: session-executor; 已对齐的发布轮次: \d+\.$/mu,
    );
    const writeReason = (sessionId, relativePath) =>
      hook({
        session_id: sessionId,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(root, relativePath), content: "" },
      }).output?.hookSpecificOutput?.permissionDecisionReason;

    const forked = hook({
      session_id: "session-executor-forked",
      hook_event_name: "SessionStart",
      source: "fork",
      transcript_path: writeTranscript(root, "executor-fork.jsonl", [
        launched,
        aligned,
      ]),
    });
    assert.match(
      forked.output.hookSpecificOutput.additionalContext,
      /已沿用原执行登记[\s\S]*已对齐[\s\S]*执行会话编号: session-executor-forked; 已对齐/u,
    );
    assert.equal(
      writeReason("session-executor-forked", "src/app.js"),
      undefined,
      "沿用对齐后可以写业务文件",
    );
    writeThroughHook(
      context,
      "session-executor-forked",
      `${folder}/receipt.md`,
      fill(commandSkeleton(project(["template", "receipt"]).stdout)),
    );

    const rewound = hook({
      session_id: "session-executor-rewound",
      hook_event_name: "UserPromptSubmit",
      prompt: "A",
      transcript_path: writeTranscript(root, "executor-rewound.jsonl", [
        launched,
      ]),
    });
    assert.match(
      rewound.output.hookSpecificOutput.additionalContext,
      /已沿用原执行登记[\s\S]*未对齐/u,
      "没有会话开始事件时, 收到消息时兜底沿用",
    );
    assert.match(
      writeReason("session-executor-rewound", "src/app.js") ?? "",
      /开工对齐尚未完成/u,
      "分叉点在对齐之前时不沿用之后的对齐",
    );

    const stranger = hook({
      session_id: "session-stranger",
      hook_event_name: "UserPromptSubmit",
      prompt: "你好",
      transcript_path: writeTranscript(root, "stranger.jsonl", ["无标记"]),
    });
    assert.equal(stranger.output, undefined, "转录中没有标记时不沿用");
    assert.match(
      writeReason("session-stranger", `${folder}/receipt.md`) ?? "",
      /本会话原是执行会话时在本会话重新发送即可/u,
    );
  },
);

projectTest("流程: 提交后未记录时, 下次进入自动纳入自己的提交", (context) => {
  const { root, project } = context;
  const folder = issueFirstOrder(context);
  assert.equal(project(["order", "set", "reviewing"]).status, 0);
  writeReview(context, folder, "通过");
  for (const status of ["accepted", "committing"]) {
    assert.equal(project(["order", "set", status]).status, 0);
  }
  commitPaths(root, [".navigator"], "feat: 导出 CSV");
  const entered = runCommand(
    PLUGIN_COMMAND,
    ["enter", "--session", ORCHESTRATOR],
    root,
  ).stdout;
  assert.match(entered, /发现自己的提交, 已自动纳入/u);
  assert.match(entered, /当前工单: 无 \(上一张 0001 已结束, committed\)/u);
  assert.equal(
    uncommittedRecords(root),
    "",
    "自动纳入按提交结算, 不改写状态文件",
  );
  assert.match(project(["status"]).stdout, /对账结果: 一致/u);
});

projectTest(
  "流程: 用 git 回退状态目录后, 在线编排会话保持身份, 对账报不符, 编排命令暂停",
  (context) => {
    const { root, project, hook } = context;
    assert.equal(project(["stage", "1"]).status, 0);
    const own = commitPaths(
      root,
      [".navigator", ".claude/settings.json"],
      "chore: 记录",
    );
    const takeover = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", "session-online"],
      root,
    ).stdout;
    assert.match(takeover, /本会话是编排会话/u);
    assert.equal(project(["step", "research"]).status, 0);
    runGit(root, ["reset", "-q", "--hard", own]);

    const draftWrite = hook({
      session_id: "session-online",
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: path.join(root, ".navigator", "drafts", "change.json"),
        content: "{}",
      },
    });
    assert.equal(draftWrite.output, undefined, "回退记录不改变会话身份");

    const status = project(["status"]).stdout;
    assert.match(status, /对账结果: 状态目录与快照不符/u);
    assert.match(status, /改动文件: .navigator\/state.json/u);
    assert.match(status, /使用第 3 组选项/u);
    const paused = project(["stage", "2"]);
    assert.equal(paused.status, 1, "记录被回退时编排命令暂停");
    assert.match(paused.stdout, /被改动过/u);

    const target = /运行 restore ([0-9a-f]{7})/u.exec(status)?.[1];
    assert.ok(target !== undefined, status);
    assert.equal(project(["restore", target]).status, 0);
    const state = JSON.parse(
      readFileSync(path.join(root, ".navigator", "state.json"), "utf8"),
    );
    assert.equal(state.step, "research", "恢复出回退之前的记录");
    assert.match(project(["status"]).stdout, /对账结果: 一致/u);
    assert.equal(project(["stage", "2"]).status, 0);
  },
);

projectTest(
  "流程: 写入后被其它 hook 改写的记录文件, 对账仍然一致",
  (context) => {
    const { root, project, hook } = context;
    const folder = issueFirstOrder(context);
    const receipt = path.join(root, folder, "receipt.md");
    const content = fill(
      commandSkeleton(project(["template", "receipt"]).stdout),
    );
    writeFileSync(receipt, content, "utf8");
    hook({
      session_id: EXECUTOR,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: receipt },
    });
    writeFileSync(receipt, `${content}\n`, "utf8");
    assert.equal(
      hook({ session_id: EXECUTOR, hook_event_name: "Stop" }).status,
      0,
    );
    assert.match(project(["status"]).stdout, /对账结果: 一致/u);

    const review = path.join(root, folder, "review.md");
    const reviewText = fill(
      commandSkeleton(project(["template", "review"]).stdout),
    );
    assert.equal(project(["order", "set", "reviewing"]).status, 0);
    writeFileSync(review, reviewText, "utf8");
    hook({
      session_id: ORCHESTRATOR,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: review },
    });
    writeFileSync(review, `${reviewText}\n`, "utf8");
    const rejected = project(["order", "set", "rejected"]);
    assert.equal(rejected.status, 0, rejected.stdout);
  },
);

projectTest(
  "流程: 会话中途手动提交后, 改变状态的命令暂停, 纳入后继续",
  (context) => {
    const { root, project } = context;
    assert.equal(project(["stage", "1"]).status, 0);
    writeFileSync(path.join(root, "README.md"), "# 改动\n", "utf8");
    commitPaths(root, ["README.md"], "docs: 手动提交");
    const paused = project(["stage", "2"]);
    assert.equal(paused.status, 1, "手动提交之后编排命令暂停");
    assert.match(paused.stdout, /提交历史与记录不一致 \(陌生提交/u);
    const status = project(["status"]).stdout;
    assert.match(status, /对账结果: 陌生提交/u);
    assert.match(status, /使用第 2 组选项/u);
    assert.equal(project(["adopt"]).status, 0);
    assert.equal(project(["stage", "2"]).status, 0);
  },
);

projectTest(
  "流程: 阶段完成时有未入库的产物, 先处理阶段提交再推进",
  (context) => {
    const { root, project } = context;
    commitPaths(root, [".navigator", ".claude/settings.json"], "chore: 接入");
    assert.equal(project(["stage", "1"]).status, 0);
    const quiet = project(["stage", "2"]);
    assert.doesNotMatch(
      quiet.stdout,
      /阶段提交/u,
      "只有状态文件改动时不请用户提交",
    );
    writeThroughHook(
      context,
      ORCHESTRATOR,
      ".navigator/plan/main-flow.md",
      fill(commandSkeleton(project(["template", "main-flow"]).stdout)),
    );
    const entered = project(["stage", "3"]);
    assert.equal(entered.status, 0, entered.stdout);
    assert.match(entered.stdout, /下一动作: 回复 "阶段提交"/u);
    assert.match(
      project(["status"]).stdout,
      /提交 "阶段 2 \(主线\) 完成" 的成果/u,
    );
    const blocked = project([
      "order",
      "new",
      "--kind",
      "selection",
      "--slug",
      "db",
    ]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /阶段提交 "阶段 2 \(主线\) 完成" 尚未处理/u);
    assert.equal(project(["stagecommit", "skip"]).status, 0);
    assert.equal(
      project(["order", "new", "--kind", "selection", "--slug", "db"]).status,
      0,
    );
  },
);

projectTest("流程: 项目收尾时确认收尾, 收尾记录经阶段提交入库", (context) => {
  const { root, project } = context;
  commitPaths(root, [".navigator", ".claude/settings.json"], "chore: 接入");
  const early = project(["finish"]);
  assert.equal(early.status, 1, "最后一个阶段之前不能确认收尾");
  assert.match(early.stdout, /只能在阶段 6 确认收尾/u);
  assert.equal(project(["stage", "6"]).status, 0);
  assert.equal(
    project(["step", "finished"]).status,
    1,
    "完成标记只由 finish 设置",
  );
  writeThroughHook(
    context,
    ORCHESTRATOR,
    ".navigator/plan/main-flow.md",
    fill(commandSkeleton(project(["template", "main-flow"]).stdout)),
  );
  const finished = project(["finish"]);
  assert.equal(finished.status, 0, finished.stdout);
  assert.match(finished.stdout, /下一动作: 回复 "阶段提交"/u);
  assert.match(
    project(["status"]).stdout,
    /提交 "阶段 6 \(收尾\) 完成" 的成果/u,
  );
  assert.equal(project(["stagecommit", "start"]).status, 0);
  const head = commitPaths(root, [".navigator"], "docs: 项目收尾");
  const done = project(["stagecommit", "done"]);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(
    uncommittedRecords(root),
    "",
    "收尾之后再没有提交, 状态文件不能留在工作区",
  );
  assert.ok(
    commitSkillDenial(context) !== undefined,
    "收尾提交完成后不再放行提交技能",
  );
  const entered = runCommand(
    PLUGIN_COMMAND,
    ["enter", "--session", ORCHESTRATOR],
    root,
  ).stdout;
  assert.match(entered, /对账结果: 一致/u);
  assert.match(entered, new RegExp(`记录提交: ${head.slice(0, 7)}`, "u"));
  assert.equal(uncommittedRecords(root), "", "进入时不改写状态文件");
  const status = project(["status"]).stdout;
  assert.match(status, /下一动作: 项目已确认收尾/u);
  assert.doesNotMatch(status, /继续阶段 6/u);
  assert.doesNotMatch(
    project(["finish"]).stdout,
    /阶段提交/u,
    "再次确认收尾时没有新的产物, 不请用户提交",
  );
  assert.equal(project(["stage", "5"]).status, 0, "继续迭代时回到阶段 5");
});

projectTest(
  "流程: 收尾记录已入库时确认收尾, 完成标记仍经阶段提交入库",
  (context) => {
    const { root, project } = context;
    commitPaths(root, [".navigator", ".claude/settings.json"], "chore: 接入");
    assert.equal(project(["stage", "6"]).status, 0);
    writeThroughHook(
      context,
      ORCHESTRATOR,
      ".navigator/plan/main-flow.md",
      fill(commandSkeleton(project(["template", "main-flow"]).stdout)),
    );
    commitPaths(root, [".navigator"], "docs: 项目收尾");
    assert.match(project(["status"]).stdout, /对账结果: 陌生提交/u);
    assert.equal(project(["adopt"]).status, 0);
    const finished = project(["finish"]);
    assert.equal(finished.status, 0, finished.stdout);
    assert.match(
      finished.stdout,
      /下一动作: 回复 "阶段提交"/u,
      "完成标记还没入库, 仍请用户提交",
    );
    assert.equal(project(["stagecommit", "start"]).status, 0);
    commitPaths(root, [".navigator"], "chore: 确认收尾");
    const done = project(["stagecommit", "done"]);
    assert.equal(done.status, 0, done.stdout);
    assert.equal(uncommittedRecords(root), "", "完成标记入库后工作区干净");
    assert.match(project(["status"]).stdout, /下一动作: 项目已确认收尾/u);
  },
);

projectTest("流程: 记录被改动时先处理验收异常, 其它命令暂停", (context) => {
  const { root, project } = context;
  const brief = path.join(root, ".navigator", "plan", "notes.md");
  writeFileSync(brief, "手工改动\n", "utf8");
  const entered = runCommand(
    PLUGIN_COMMAND,
    ["enter", "--session", ORCHESTRATOR],
    root,
  ).stdout;
  assert.match(entered, /对账结果: 状态目录与快照不符/u);
  assert.match(entered, /改动文件: .navigator\/plan\/notes.md/u);
  assert.match(entered, /使用第 3 组选项/u);
  const blocked = project(["stage", "1"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /尚未处理/u);
  assert.equal(project(["adopt"]).status, 0);
  assert.equal(project(["stage", "1"]).status, 0);
  const again = runCommand(
    PLUGIN_COMMAND,
    ["enter", "--session", ORCHESTRATOR],
    root,
  ).stdout;
  assert.match(again, /对账结果: 一致/u);
});

projectTest("流程: 恢复快照撤销改动", (context) => {
  const { root, project } = context;
  const notes = path.join(root, ".navigator", "plan", "notes.md");
  writeFileSync(notes, "手工改动\n", "utf8");
  const entered = runCommand(
    PLUGIN_COMMAND,
    ["enter", "--session", ORCHESTRATOR],
    root,
  ).stdout;
  const target = /运行 restore ([0-9a-f]{7})/u.exec(entered)?.[1];
  assert.ok(target !== undefined, entered);
  assert.equal(project(["restore", target]).status, 0);
  assert.equal(existsSync(notes), false);
  assert.match(project(["status"]).stdout, /已有编排会话登记/u);
  assert.match(project(["status"]).stdout, /对账结果: 一致/u);
});

projectTest("流程: 体检与项目规范", (context) => {
  const { root, project } = context;
  writeFileSync(
    path.join(root, ".navigator", "plan", "notes.md"),
    "# 随手记录\n\n它可以赋能团队.\n",
    "utf8",
  );
  project(["adopt"]);
  const checkup = project(["check"]);
  assert.equal(checkup.status, 0, checkup.stdout);
  assert.match(checkup.stdout, /体检编号: 0001/u);
  assert.match(checkup.stdout, /黑话用词/u);
  const draft = writeDraft(root, "standards.json", {
    commentLanguage: "中文",
    conventions: ["以项目现有的 ESLint 配置为准."],
  });
  assert.equal(project(["standards", "--from", draft]).status, 0);
  const rules = readFileSync(
    path.join(root, ".claude", "rules", "engineering.md"),
    "utf8",
  );
  assert.match(rules, /代码注释使用中文\./u);
  assert.match(rules, /1\. 以项目现有的 ESLint 配置为准\./u);
  assert.equal(
    runGit(root, ["status", "--porcelain", "--", ".claude/rules"]).length > 0,
    true,
  );
});
