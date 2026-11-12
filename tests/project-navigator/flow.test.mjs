/**
 * @file 端到端测试: 用插件的命令行与 hook 走完工单往返, 受阻继续, 验收不通过,
 * 以及 hook 对编排会话的认定, 回复校验与提醒.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PLACEHOLDER } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import {
  commandSkeleton,
  commitPaths,
  createTemporaryRepository,
  initializeProject,
  runHook,
  writeTranscript,
} from "./helpers.mjs";

/**
 * 测试用的代码检查命令.
 * @type {string}
 */
const CHECK_COMMAND = "npm run lint";

/**
 * 执行子代理的类型.
 * @type {string}
 */
const EXECUTOR = "waypoint:navigator-executor";

/**
 * 写入项目中的文件, 目录不存在时先创建.
 *
 * @param {string} root 项目根目录.
 * @param {string} relative 项目相对路径.
 * @param {string} content 文件内容.
 * @returns {void}
 */
function writeProjectFile(root, relative, content) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

/**
 * 把骨架中的占位标记全部替换为内容.
 *
 * @param {string} skeleton 骨架.
 * @param {string} filler 替换用的文字.
 * @returns {string} 填好的全文.
 */
function fill(skeleton, filler = "已填写") {
  return skeleton.split(PLACEHOLDER).join(filler);
}

/**
 * 建立一个已初始化, 在阶段 5, 已登记检查命令的项目, 以及编排会话的转录.
 *
 * @param {import("node:test").TestContext} context 测试上下文.
 * @returns {{root: string, project: (args: readonly string[]) => {status: number | null, stdout: string}, orchestrator: string, other: string}} 项目与两份转录.
 */
function setupProject(context) {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  const orchestrator = writeTranscript(root, true);
  const other = writeTranscript(root, false);
  context.after(orchestrator.cleanup);
  context.after(other.cleanup);
  project(["stage", "5"]);
  writeProjectFile(
    root,
    ".navigator/drafts/checks.json",
    JSON.stringify({ commands: [CHECK_COMMAND] }),
  );
  project(["codecheck", "set", "--from", ".navigator/drafts/checks.json"]);
  return {
    root,
    project,
    orchestrator: orchestrator.path,
    other: other.path,
  };
}

/**
 * 模拟一次写入类工具调用, 返回守卫的判定.
 *
 * @param {string} root 项目根目录.
 * @param {object} options 参数.
 * @param {string} options.target 目标的项目相对路径.
 * @param {string} options.transcript 主会话的转录路径.
 * @param {string} [options.agentType] 子代理类型; 省略时为主会话.
 * @returns {"allow" | "deny"} 判定.
 */
function writeDecision(root, { target, transcript, agentType }) {
  const output = runHook(
    {
      session_id: "s",
      transcript_path: transcript,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: path.join(root, target), content: "x" },
      ...(agentType === undefined
        ? {}
        : { agent_id: "agent-1", agent_type: agentType }),
    },
    root,
  ).output;
  return output?.hookSpecificOutput?.permissionDecision === "deny"
    ? "deny"
    : "allow";
}

/**
 * 模拟编排会话回复结束.
 *
 * @param {string} root 项目根目录.
 * @param {string} transcript 转录路径.
 * @param {string} text 回复全文.
 * @param {Record<string, unknown>} [extra] 附加的输入字段.
 * @returns {any} hook 输出.
 */
function stop(root, transcript, text, extra = {}) {
  return runHook(
    {
      session_id: "s",
      transcript_path: transcript,
      hook_event_name: "Stop",
      last_assistant_message: text,
      ...extra,
    },
    root,
  ).output;
}

/**
 * 模拟用户在编排会话中发一条消息.
 *
 * @param {string} root 项目根目录.
 * @param {string} transcript 转录路径.
 * @param {string} prompt 消息.
 * @returns {any} hook 输出.
 */
function prompt(root, transcript, prompt) {
  return runHook(
    {
      session_id: "s",
      transcript_path: transcript,
      hook_event_name: "UserPromptSubmit",
      prompt,
    },
    root,
  ).output;
}

/**
 * 新建一张工单, 写好工单文件, 经工单审阅由用户选 A, 然后发布.
 *
 * @param {ReturnType<typeof setupProject>} setup 项目.
 * @param {string} kind 工单类型.
 * @returns {{folder: string, issue: string}} 工单文件夹与发布命令的输出.
 */
function approveAndIssue(setup, kind) {
  const { root, project, orchestrator } = setup;
  project(["order", "new", "--kind", kind, "--slug", "export"]);
  const folder = `.navigator/orders/${JSON.parse(readFileSync(path.join(root, ".navigator/state.json"), "utf8")).order.folder}`;
  writeProjectFile(
    root,
    `${folder}/order.md`,
    fill(commandSkeleton(project(["template", "order"]).stdout)),
  );
  const review = fill(commandSkeleton(project(["reply", "approve"]).stdout));
  assert.equal(stop(root, orchestrator, review), undefined);
  prompt(root, orchestrator, "A");
  return { folder, issue: project(["order", "set", "issued"]).stdout };
}

/**
 * 写一份回执.
 *
 * @param {ReturnType<typeof setupProject>} setup 项目.
 * @param {string} folder 工单文件夹.
 * @param {string} status 执行状态.
 * @returns {void}
 */
function writeReceipt(setup, folder, status) {
  const skeleton = commandSkeleton(
    setup.project(["template", "receipt"]).stdout,
  );
  writeProjectFile(
    setup.root,
    `${folder}/receipt.md`,
    fill(skeleton).replace("- 执行状态: 已填写", `- 执行状态: ${status}`),
  );
}

/**
 * 写一份验收记录, 判据核对表只有一行.
 *
 * @param {ReturnType<typeof setupProject>} setup 项目.
 * @param {string} folder 工单文件夹.
 * @param {string} verdict 判据结论.
 * @param {string} userVerdict 用户结论.
 * @returns {void}
 */
function writeReview(setup, folder, verdict, userVerdict) {
  const skeleton = commandSkeleton(
    setup.project(["template", "review"]).stdout,
  );
  writeProjectFile(
    setup.root,
    `${folder}/review.md`,
    skeleton
      .replace(
        /\| <待填写> \| <待填写> \| <待填写> \|/u,
        `| 判据 1 | ${verdict} | 日志第 3 行 |`,
      )
      .replace("- 用户结论: 待用户确认", `- 用户结论: ${userVerdict}`)
      .split(PLACEHOLDER)
      .join("已填写"),
  );
}

test("hook: 没有初始化的项目中什么也不做", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const transcript = writeTranscript(repository.root, true);
  context.after(transcript.cleanup);
  assert.equal(
    writeDecision(repository.root, {
      target: "src/app.js",
      transcript: transcript.path,
    }),
    "allow",
  );
  assert.equal(prompt(repository.root, transcript.path, "A"), undefined);
});

test("hook: 按转录认出编排会话, 只限制编排会话写业务文件", (context) => {
  const setup = setupProject(context);
  const { root, orchestrator, other } = setup;
  assert.equal(
    writeDecision(root, { target: "src/app.js", transcript: orchestrator }),
    "deny",
  );
  assert.equal(
    writeDecision(root, {
      target: ".navigator/plan/brief.md",
      transcript: orchestrator,
    }),
    "allow",
  );
  assert.equal(
    writeDecision(root, { target: "src/app.js", transcript: other }),
    "allow",
  );
  assert.equal(
    writeDecision(root, {
      target: ".navigator/state.json",
      transcript: other,
    }),
    "deny",
  );
});

test("hook: 编排会话收到消息与压缩上下文后得到位置提醒, 其它会话没有", (context) => {
  const { root, orchestrator, other } = setupProject(context);
  const reminder =
    prompt(root, orchestrator, "继续")?.hookSpecificOutput?.additionalContext ??
    "";
  assert.match(reminder, /你是编排会话. 阶段 5\/6 \(切片\)/u);
  assert.equal(prompt(root, other, "继续"), undefined);
  const compact = runHook(
    {
      session_id: "s",
      transcript_path: orchestrator,
      hook_event_name: "SessionStart",
      source: "compact",
    },
    root,
  ).output?.hookSpecificOutput?.additionalContext;
  assert.match(
    compact ?? "",
    /上下文刚被压缩: 先运行 project-navigator status/u,
  );
});

test("hook: 只校验编排会话回复的结构, 打回一次后放行, 后台任务进行中照常校验", (context) => {
  const setup = setupProject(context);
  const { root, project, orchestrator, other } = setup;
  const valid = fill(commandSkeleton(project(["reply", "freeform"]).stdout));
  assert.equal(stop(root, orchestrator, valid), undefined);
  const broken = valid.replace(/^结论: .+\n/mu, "");
  const blocked = stop(root, orchestrator, broken);
  assert.equal(blocked?.decision, "block");
  assert.match(blocked.reason, /结论行/u);
  assert.equal(
    stop(root, orchestrator, broken, { stop_hook_active: true }),
    undefined,
  );
  const background = { background_tasks: [{ id: "t" }] };
  assert.equal(stop(root, orchestrator, broken, background)?.decision, "block");
  for (const id of ["reviewing", "waiting"]) {
    const waiting = fill(commandSkeleton(project(["reply", id]).stdout));
    assert.doesNotMatch(waiting, /```/u);
    assert.equal(stop(root, orchestrator, waiting, background), undefined);
  }
  assert.equal(stop(root, other, "随便说点什么"), undefined);
});

test("工单往返: 审阅发布, 执行子代理写回执, 验收通过, 输出提交步骤", (context) => {
  const setup = setupProject(context);
  const { root, project } = setup;
  const { folder, issue } = approveAndIssue(setup, "implementation");
  assert.match(issue, /run_in_background\) 派 waypoint:navigator-executor/u);
  assert.match(project(["exec-brief"]).stdout, /^# 执行工单 0001/u);
  assert.equal(
    writeDecision(root, {
      target: "src/app.js",
      transcript: setup.orchestrator,
      agentType: EXECUTOR,
    }),
    "allow",
  );
  assert.equal(
    writeDecision(root, {
      target: `${folder}/order.md`,
      transcript: setup.orchestrator,
      agentType: EXECUTOR,
    }),
    "deny",
  );
  assert.match(project(["status"]).stdout, /回复 "工单执行"/u);
  assert.match(
    project(["reply", "running"]).stdout,
    /· 工单 0001 \(执行中\)\n/u,
  );
  writeReceipt(setup, folder, "完成");
  assert.match(
    project(["status"]).stdout,
    /执行状态 完成[\s\S]*order set reviewing, 再运行 review-brief[\s\S]*回复 "工单验收" \(reply reviewing\)/u,
  );
  project(["order", "set", "reviewing"]);
  assert.match(
    project(["reply", "reviewing"]).stdout,
    /· 工单 0001 \(验收中\)\n[\s\S]*## 核对重点/u,
  );
  assert.match(
    project(["review-brief"]).stdout,
    new RegExp(`- 代码检查: ${CHECK_COMMAND}`, "u"),
  );
  writeReview(setup, folder, "通过", "待用户确认");
  assert.match(
    project(["order", "set", "accepted"]).stdout,
    /还是 "待用户确认"/u,
  );
  writeReview(setup, folder, "通过", "用户亲手验证, 通过");
  const accepted = project(["order", "set", "accepted"]).stdout;
  assert.match(accepted, /工单 0001 转为 accepted/u);
  assert.match(
    accepted,
    /调用 waypoint:commit-message: 只提交时参数写 "提交, 纳入范围/u,
  );
});

test("工单往返: 认可之后改过工单, 发布被拒; 未验证的判据要用户明确接受", (context) => {
  const setup = setupProject(context);
  const { root, project, orchestrator } = setup;
  project(["order", "new", "--kind", "implementation", "--slug", "export"]);
  const folder = ".navigator/orders/0001-export";
  const order = fill(commandSkeleton(project(["template", "order"]).stdout));
  writeProjectFile(root, `${folder}/order.md`, order);
  stop(
    root,
    orchestrator,
    fill(commandSkeleton(project(["reply", "approve"]).stdout)),
  );
  prompt(root, orchestrator, "A");
  writeProjectFile(root, `${folder}/order.md`, `${order}\n补一句.\n`);
  assert.equal(project(["order", "set", "issued"]).status, 1);
  writeProjectFile(root, `${folder}/order.md`, order);
  stop(
    root,
    orchestrator,
    fill(commandSkeleton(project(["reply", "approve"]).stdout)),
  );
  prompt(root, orchestrator, "A");
  assert.equal(project(["order", "set", "issued"]).status, 0);
  writeReceipt(setup, folder, "完成");
  project(["order", "set", "reviewing"]);
  writeReview(setup, folder, "未验证", "接受现状");
  assert.equal(project(["reply", "review", "--option", "1"]).status, 1);
  assert.equal(project(["reply", "review", "--option", "3"]).status, 0);
  assert.match(
    project(["order", "set", "accepted"]).stdout,
    /--accept-unverified/u,
  );
  assert.match(
    project(["order", "set", "accepted", "--accept-unverified"]).stdout,
    /转为 accepted/u,
  );
});

test("工单审阅: 没有选发布之后, 写明发布工单的消息仍然认可, 单独的字母不算", (context) => {
  const setup = setupProject(context);
  const { root, project, orchestrator } = setup;
  project(["order", "new", "--kind", "implementation", "--slug", "export"]);
  const folder = ".navigator/orders/0001-export";
  const order = fill(commandSkeleton(project(["template", "order"]).stdout));
  writeProjectFile(root, `${folder}/order.md`, order);
  stop(
    root,
    orchestrator,
    fill(commandSkeleton(project(["reply", "approve"]).stdout)),
  );
  prompt(root, orchestrator, "判据 3 是什么意思?");
  const refused = project(["order", "set", "issued"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /只运行 reply 命令不算审阅/u);
  prompt(root, orchestrator, "A");
  assert.equal(project(["order", "set", "issued"]).status, 1);
  writeProjectFile(root, `${folder}/order.md`, `${order}\n补一句.\n`);
  prompt(root, orchestrator, "发布工单");
  assert.equal(project(["order", "set", "issued"]).status, 1);
  writeProjectFile(root, `${folder}/order.md`, order);
  prompt(root, orchestrator, "发布工单");
  assert.equal(project(["order", "set", "issued"]).status, 0);
});

test("基准提交: 新建工单之后仓库有新提交时, 审阅拒绝旧值, 发布后验收提示词用当前提交", (context) => {
  const setup = setupProject(context);
  const { root, project, orchestrator } = setup;
  project(["order", "new", "--kind", "implementation", "--slug", "export"]);
  const folder = ".navigator/orders/0001-export";
  const stale = fill(commandSkeleton(project(["template", "order"]).stdout));
  writeProjectFile(root, "CHANGES.md", "升级.\n");
  const head = commitPaths(root, ["CHANGES.md"], "升级").trim();
  assert.doesNotMatch(stale, new RegExp(head, "u"));
  writeProjectFile(root, `${folder}/order.md`, stale);
  const refused = project(["reply", "approve"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, new RegExp(`把 "基准提交" 改为 ${head}`, "u"));
  const order = fill(commandSkeleton(project(["template", "order"]).stdout));
  assert.match(order, new RegExp(`- 基准提交: ${head}`, "u"));
  writeProjectFile(root, `${folder}/order.md`, order);
  stop(
    root,
    orchestrator,
    fill(commandSkeleton(project(["reply", "approve"]).stdout)),
  );
  prompt(root, orchestrator, "A");
  assert.equal(project(["order", "set", "issued"]).status, 0);
  writeReceipt(setup, folder, "完成");
  project(["order", "set", "reviewing"]);
  const brief = project(["review-brief"]).stdout;
  assert.match(brief, new RegExp(`- 基准提交: ${head}`, "u"));
  assert.match(brief, new RegExp(`git diff ${head} --stat`, "u"));
});

test("工单审阅: 骨架从工单文件的审阅要点预填, 并写出工单文件路径", (context) => {
  const setup = setupProject(context);
  const { root, project } = setup;
  project(["order", "new", "--kind", "implementation", "--slug", "export"]);
  const order = fill(
    commandSkeleton(project(["template", "order"]).stdout),
  ).replace("- 需要决定: 已填写", "- 需要决定: 是否在仓库内维护补丁");
  writeProjectFile(root, ".navigator/orders/0001-export/order.md", order);
  const skeleton = commandSkeleton(project(["reply", "approve"]).stdout);
  assert.match(skeleton, /- 需要决定: 是否在仓库内维护补丁/u);
  assert.match(
    skeleton,
    /- 工单文件: \.navigator\/orders\/0001-export\/order\.md/u,
  );
  assert.match(skeleton, /A\. 发布工单, 开始执行\./u);
});

test("受阻: 内容没有改动时直接继续, 由原执行子代理接着做; 改动后要重新审阅", (context) => {
  const setup = setupProject(context);
  const { root, project } = setup;
  const { folder } = approveAndIssue(setup, "implementation");
  writeReceipt(setup, folder, "受阻");
  assert.match(
    project(["status"]).stdout,
    /执行受阻: 读回执, 运行 order set blocked/u,
  );
  project(["order", "set", "blocked"]);
  const resumed = project(["order", "set", "issued"]).stdout;
  assert.match(resumed, /旧回执已归档/u);
  assert.match(resumed, /用 SendMessage 让原执行子代理继续/u);
  writeReceipt(setup, folder, "受阻");
  project(["order", "set", "blocked"]);
  writeProjectFile(
    root,
    `${folder}/order.md`,
    `${readFileSync(path.join(root, folder, "order.md"), "utf8")}\n改了.\n`,
  );
  assert.match(project(["status"]).stdout, /必须重新审阅/u);
  assert.equal(project(["order", "set", "issued"]).status, 1);
});

test("验收不通过: 运行检查工单重发同类工单, 实现工单先判断是否太大", (context) => {
  const setup = setupProject(context);
  const { project } = setup;
  const runcheck = approveAndIssue(setup, "runcheck");
  assert.equal(
    writeDecision(setup.root, {
      target: "src/app.js",
      transcript: setup.orchestrator,
      agentType: EXECUTOR,
    }),
    "deny",
  );
  writeReceipt(setup, runcheck.folder, "完成");
  project(["order", "set", "reviewing"]);
  assert.match(
    project(["order", "set", "rejected"]).stdout,
    /order new --kind runcheck, 重发同类工单/u,
  );
  const implementation = approveAndIssue(setup, "implementation");
  writeReceipt(setup, implementation.folder, "完成");
  project(["order", "set", "reviewing"]);
  const rejected = project(["order", "set", "rejected"]).stdout;
  assert.match(rejected, /超出一次执行或验收的能力时拆成更小的工单/u);
  assert.match(rejected, /order new --kind fix/u);
});

test("代码检查: 没有登记检查命令时不能新建实现工单, 运行检查工单不受影响", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { project } = initializeProject(repository.root);
  project(["stage", "0"]);
  const refused = project([
    "order",
    "new",
    "--kind",
    "implementation",
    "--slug",
    "demo",
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /还没有登记代码检查命令/u);
  assert.equal(
    project(["order", "new", "--kind", "runcheck", "--slug", "runcheck"])
      .status,
    0,
  );
});

test("阶段: 推进阶段时提示提交上一阶段的产物, 确认收尾时把完成标记算进去", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  project(["stage", "1"]);
  writeProjectFile(root, ".navigator/plan/brief.md", "# 项目简报\n");
  assert.match(
    project(["stage", "2"]).stdout,
    /调用 waypoint:commit-message 提交 "阶段 1 \(立项\) 完成"/u,
  );
  project(["stage", "6"]);
  assert.match(project(["finish"]).stdout, /提交 "项目收尾" 的技能产物/u);
});
