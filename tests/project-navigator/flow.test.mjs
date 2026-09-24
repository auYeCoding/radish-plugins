/**
 * @file 工单往返的端到端测试: 在临时仓库中用项目内的命令行与 hook 走完
 * 路线 → 工单 → 执行会话登记与对齐 → 回执 → 验收 → 提交, 以及对账异常与体检.
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
  replySkeleton,
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
 * 测试用的代码检查命令.
 * @type {string}
 */
const CODE_CHECK_COMMAND = "npm run lint";

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
 * 把骨架中的占位符替换为内容.
 *
 * @param {string} text 骨架.
 * @returns {string} 填好的文本.
 */
function fill(text) {
  return text.split(PLACEHOLDER).join(FILLER);
}

/**
 * 按骨架写入验收记录, 判据核对只有一行, 结论为指定值.
 *
 * @param {string} folder 工单文件夹的绝对路径.
 * @param {(args: readonly string[]) => {status: number | null, stdout: string}} project 调用项目内命令行的函数.
 * @param {string} verdict 判据结论.
 * @returns {void}
 */
function writeReview(folder, project, verdict) {
  const text = fill(project(["template", "review"]).stdout).replace(
    `| ${FILLER} | ${FILLER} | ${FILLER} |`,
    `| ${FILLER} | ${verdict} | ${FILLER} |`,
  );
  writeFileSync(path.join(folder, "review.md"), text, "utf8");
}

/**
 * 写入草稿文件并返回其相对路径.
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
 * @param {(context: {root: string, project: ReturnType<typeof initializeProject>["project"], hook: ReturnType<typeof initializeProject>["hook"]}) => void} body 测试内容.
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
 * @param {{root: string, project: (args: readonly string[]) => {status: number | null, stdout: string}}} context 测试上下文.
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
 * 建立推进路线并发布第一张工单, 返回工单文件夹的绝对路径.
 *
 * @param {{root: string, project: (args: readonly string[]) => {status: number | null, stdout: string}, hook: (input: Record<string, unknown>) => {status: number | null, output: any}}} context 测试上下文.
 * @returns {string} 工单文件夹的绝对路径.
 */
function issueFirstOrder({ root, project, hook }) {
  assert.equal(project(["stage", "5"]).status, 0);
  const draft = writeDraft(root, "roadmap.json", ROADMAP_DRAFT);
  assert.equal(project(["roadmap", "--from", draft]).status, 0);
  assert.equal(project(["slice", "0001", "active"]).status, 0);
  registerCodeCheck({ root, project });
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
  const folder = path.join(root, ".navigator", "orders", "0001-export-csv");
  const orderText = fill(project(["template", "order"]).stdout);
  const orderFile = path.join(folder, "order.md");
  const decision = hook({
    session_id: ORCHESTRATOR,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: orderFile, content: orderText },
  });
  assert.equal(decision.output, undefined, "合格的工单可以写入");
  mkdirSync(folder, { recursive: true });
  writeFileSync(orderFile, orderText, "utf8");
  assert.equal(project(["order", "set", "issued"]).status, 0);
  return folder;
}

projectTest("流程: 路线与工单发布, 回复骨架带启动提示词", (context) => {
  const { root, project, hook } = context;
  issueFirstOrder(context);
  assert.ok(existsSync(path.join(root, ".navigator", "plan", "roadmap.md")));
  const reply = replySkeleton(project(["reply", "order"]).stdout);
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

projectTest("流程: 执行会话登记, 对齐, 回执, 验收与提交", (context) => {
  const { root, project, hook } = context;
  const folder = issueFirstOrder(context);
  const launchPrompt = /```markdown\n([\s\S]*?)\n```/u.exec(
    project(["reply", "order"]).stdout,
  )?.[1];
  const registered = hook({
    session_id: EXECUTOR,
    hook_event_name: "UserPromptSubmit",
    prompt: launchPrompt,
  });
  assert.match(
    registered.output.hookSpecificOutput.additionalContext,
    /工单 0001 的执行会话/u,
  );
  const businessWrite = {
    session_id: EXECUTOR,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "app.js"), content: "" },
  };
  assert.equal(
    hook(businessWrite).output.hookSpecificOutput.permissionDecision,
    "deny",
    "对齐之前不能写业务文件",
  );
  const alignment = fill(replySkeleton(project(["reply", "align"]).stdout));
  assert.equal(
    hook({
      session_id: EXECUTOR,
      hook_event_name: "Stop",
      last_assistant_message: alignment,
    }).output,
    undefined,
  );
  hook({
    session_id: EXECUTOR,
    hook_event_name: "UserPromptSubmit",
    prompt: "A",
  });
  assert.equal(hook(businessWrite).output, undefined, "对齐之后可以写业务文件");
  const commit = hook({
    session_id: EXECUTOR,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git commit -m x" },
  });
  assert.equal(commit.output.hookSpecificOutput.permissionDecision, "deny");

  const receiptFile = path.join(folder, "receipt.md");
  const receiptText = fill(project(["template", "receipt"]).stdout);
  assert.equal(
    hook({
      session_id: EXECUTOR,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: receiptFile, content: receiptText },
    }).output,
    undefined,
  );
  writeFileSync(receiptFile, receiptText, "utf8");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.js"), "export {};\n", "utf8");
  hook({
    session_id: EXECUTOR,
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: receiptFile },
  });

  const status = project(["status"]).stdout;
  assert.match(status, /回执已写入/u);
  assert.match(status, /已有回执/u);
  assert.match(status, /对账结果: 一致/u, "执行会话写回执后拍了快照");

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
  assert.equal(
    hook(businessWrite).output.hookSpecificOutput.permissionDecision,
    "deny",
    "验收中执行会话不能再改业务文件",
  );
  writeReview(folder, project, "通过");
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
  const after = project(["status"]).stdout;
  assert.match(after, /对账结果: 一致/u);
  assert.match(after, new RegExp(`记录提交: ${head.slice(0, 7)}`, "u"));
});

projectTest(
  "流程: 开工对齐前有一句过程说明时, 用户选 A 后可以写业务文件",
  (context) => {
    const { root, project, hook } = context;
    issueFirstOrder(context);
    const launchPrompt = /```markdown\n([\s\S]*?)\n```/u.exec(
      project(["reply", "order"]).stdout,
    )?.[1];
    hook({
      session_id: EXECUTOR,
      hook_event_name: "UserPromptSubmit",
      prompt: launchPrompt,
    });
    const alignment = `对账相符, 计划已做完, 下面是开工对齐.\n\n---\n\n${fill(replySkeleton(project(["reply", "align"]).stdout))}`;
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
      hook({
        session_id: EXECUTOR,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: path.join(root, "src", "app.js"),
          content: "",
        },
      }).output,
      undefined,
      "对齐已被识别, 可以写业务文件",
    );
  },
);

projectTest(
  "流程: 实现工单必须带代码检查判据, 检查命令算作已授权测试",
  ({ root, project, hook }) => {
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
    const orderFile = path.join(
      root,
      ".navigator",
      "orders",
      "0001-export-csv",
      "order.md",
    );
    mkdirSync(path.dirname(orderFile), { recursive: true });
    const writeOrder = () =>
      writeFileSync(
        orderFile,
        fill(project(["template", "order"]).stdout),
        "utf8",
      );
    writeOrder();
    const unregistered = project(["order", "set", "issued"]);
    assert.equal(unregistered.status, 1);
    assert.match(unregistered.stdout, /codecheck set/u);
    registerCodeCheck({ root, project });
    const missing = project(["order", "set", "issued"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /缺少代码检查判据/u);
    writeOrder();
    assert.equal(project(["order", "set", "issued"]).status, 0);
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
    writeReview(folder, project, "未验证");
    const refused = project(["order", "set", "accepted"]);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /结论为 "未验证"/u);
    const manual = project(["reply", "review", "--option", "1"]);
    assert.equal(manual.status, 1);
    assert.match(manual.stdout, /order set rejected/u);
    assert.equal(project(["reply", "review", "--option", "2"]).status, 0);
    writeReview(folder, project, "通过");
    assert.equal(project(["reply", "review", "--option", "1"]).status, 0);
    assert.equal(project(["order", "set", "accepted"]).status, 0);
  },
);

projectTest(
  "流程: 选型工单核对证据需要回执, 不通过时下一动作是新建选型工单",
  ({ root, project }) => {
    const noOrder = project(["evidence"]);
    assert.equal(noOrder.status, 1);
    assert.match(noOrder.stdout, /当前没有选型工单/u);
    assert.equal(
      project(["order", "new", "--kind", "selection", "--slug", "transport"])
        .status,
      0,
    );
    const folder = path.join(root, ".navigator", "orders", "0001-transport");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, "order.md"),
      fill(project(["template", "order"]).stdout),
      "utf8",
    );
    assert.equal(project(["order", "set", "issued"]).status, 0);
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
        tool_input: { file_path: path.join(folder, "order.md") },
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

projectTest("流程: 提交后未记录时, 下次进入自动纳入自己的提交", (context) => {
  const { root, project } = context;
  const folder = issueFirstOrder(context);
  assert.equal(project(["order", "set", "reviewing"]).status, 0);
  writeReview(folder, project, "通过");
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
  assert.match(entered, /当前工单: 无/u);
});

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
  assert.match(project(["status"]).stdout, /本会话|已有编排会话登记/u);
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
