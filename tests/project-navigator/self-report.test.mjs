/**
 * @file 技能异常自检与问题报告的测试: 异常的判断与记录, 原地打转, 状态自检,
 * 命令与 hook 出错时的记录, report 命令生成的报告.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  EVENT_KINDS,
  isInternalError,
  isRecommendedCommand,
  markEventsReported,
  readEvents,
  recordEvent,
  trackGuidance,
  unreportedEvents,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/diagnostics.mjs";
import {
  GUIDANCE_FILE,
  registryDirectory,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/paths.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { checkStateConsistency } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state-checks.mjs";
import { createInitialState } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { WorkflowError } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-error.mjs";
import {
  createTemporaryRepository,
  initializeProject,
  writeTranscript,
} from "./helpers.mjs";

/**
 * 测试中使用的固定时间.
 * @type {string}
 */
const NOW = "2026-11-10T00:00:00.000Z";

/**
 * 状态文件的项目相对路径.
 * @type {string}
 */
const STATE_FILE = ".navigator/state.json";

/**
 * 报告中不应出现的字样: 报告只写遇到的情况, 不写原因推测与处理建议.
 * @type {RegExp}
 */
const ADVICE_PATTERN = /建议|修复方案|可能的原因|处理办法/u;

/**
 * 构造一条测试用的异常.
 *
 * @param {Partial<import("../../plugins/waypoint/skills/project-navigator/runtime/lib/diagnostics.mjs").DiagnosticEvent>} [overrides] 要覆盖的字段.
 * @returns {Omit<import("../../plugins/waypoint/skills/project-navigator/runtime/lib/diagnostics.mjs").DiagnosticEvent, "reportId">} 异常.
 */
function sampleEvent(overrides = {}) {
  return {
    kind: EVENT_KINDS.internalError,
    source: "status",
    message: "x is not a function",
    stack: [],
    at: NOW,
    ...overrides,
  };
}

/**
 * 修改项目的状态文件.
 *
 * @param {string} root 项目根目录.
 * @param {(state: Record<string, any>) => Record<string, any>} change 返回新状态的函数.
 * @returns {void}
 */
function changeState(root, change) {
  const file = path.join(root, STATE_FILE);
  writeFileSync(
    file,
    `${JSON.stringify(change(JSON.parse(readFileSync(file, "utf8"))), null, 2)}\n`,
    "utf8",
  );
}

/**
 * 在项目的草稿目录中写一份 JSON 草稿.
 *
 * @param {string} root 项目根目录.
 * @param {string} name 文件名.
 * @param {unknown} value 草稿内容.
 * @returns {string} 草稿的项目相对路径.
 */
function writeDraft(root, name, value) {
  const relative = `.navigator/drafts/${name}`;
  mkdirSync(path.join(root, ".navigator", "drafts"), { recursive: true });
  writeFileSync(path.join(root, relative), JSON.stringify(value), "utf8");
  return relative;
}

test("异常判断: 流程拒绝与参数写错不算内部错误, 类型错误与文件系统错误算", () => {
  assert.equal(isInternalError(new WorkflowError("当前没有工单.")), false);
  assert.equal(isInternalError(new Error("未知命令")), false);
  assert.equal(
    isInternalError(
      Object.assign(new TypeError("未知选项"), {
        code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      }),
    ),
    false,
  );
  assert.equal(isInternalError(new TypeError("x is not a function")), true);
  assert.equal(
    isInternalError(Object.assign(new Error("没有权限"), { code: "EACCES" })),
    true,
  );
  assert.equal(isInternalError("字符串"), false);
});

test("异常记录: 相同的未上报异常只记一次, 上报后不再列为未上报", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  assert.equal(recordEvent(root, sampleEvent()), true);
  assert.equal(recordEvent(root, sampleEvent()), false);
  assert.equal(recordEvent(root, sampleEvent({ source: "order" })), true);
  assert.equal(unreportedEvents(root).length, 2);
  markEventsReported(root, "0001");
  assert.equal(unreportedEvents(root).length, 0);
  assert.deepEqual(
    readEvents(root).map((event) => event.reportId),
    ["0001", "0001"],
  );
  assert.equal(
    recordEvent(root, sampleEvent()),
    true,
    "上报之后再次出现要重新记",
  );
});

test("原地打转: 状态不变时同一个下一动作给出 4 次记一条异常, 等待中不计数", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const guidance = { action: "运行 order set issued", revision: 3, now: NOW };
  for (let round = 0; round < 6; round += 1) {
    trackGuidance(root, { ...guidance, isWaiting: true });
  }
  assert.equal(unreportedEvents(root).length, 0);
  for (let round = 0; round < 3; round += 1) {
    trackGuidance(root, { ...guidance, isWaiting: false });
  }
  assert.equal(unreportedEvents(root).length, 0);
  trackGuidance(root, { ...guidance, isWaiting: false });
  trackGuidance(root, { ...guidance, isWaiting: false });
  const events = unreportedEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, EVENT_KINDS.stalled);
  trackGuidance(root, { ...guidance, revision: 4, isWaiting: false });
  assert.equal(unreportedEvents(root).length, 1, "状态变化后重新计数");
});

test("下一动作: 只把其中写明的命令算作要求运行的命令", () => {
  const guidance = {
    action: "运行 order set issued, 再运行 exec-brief",
    revision: 1,
    count: 1,
  };
  assert.equal(isRecommendedCommand(guidance, "order set issued"), true);
  assert.equal(isRecommendedCommand(guidance, "order set accepted"), false);
  assert.equal(isRecommendedCommand(guidance, ""), false);
  assert.equal(isRecommendedCommand(undefined, "order set issued"), false);
});

test("状态自检: 新建的状态自洽; 阶段越界, 切片不存在, 工单文件缺失都算问题", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const spec = loadSpec();
  const state = createInitialState({ skillVersion: "1.0.0", now: NOW });
  const check = (/** @type {Record<string, any>} */ changes) =>
    checkStateConsistency({
      state: { ...state, ...changes },
      projectRoot: repository.root,
      spec,
    });
  assert.deepEqual(check({}), []);
  assert.match(check({ stage: 99 })[0], /阶段编号 99/u);
  assert.match(check({ slice: "0009" })[0], /当前切片 0009/u);
  const problems = check({
    order: {
      id: "0001",
      kind: "implementation",
      status: "issued",
      slice: null,
      folder: "0001-export",
      round: 1,
    },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /工单文件 .+ 不存在/u);
});

test("状态不自洽: status 记下异常, 下一动作改为上报并暂停", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  project(["stage", "1"]);
  changeState(root, (state) => ({ ...state, stage: 99 }));
  const status = project(["status"]).stdout;
  assert.match(
    status,
    /- 技能异常: 脚本记录到 1 条还没有上报的异常 \(状态不自洽\)/u,
  );
  assert.match(status, /- 下一动作: 状态不自洽, 不能照常继续: 阶段编号 99/u);
  assert.match(status, /report --from/u);
  assert.equal(unreportedEvents(root)[0].kind, EVENT_KINDS.invalidState);
});

test("命令内部错误: 记下异常并提示上报; 流程拒绝不记", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  const refused = project(["order", "set", "issued"]);
  assert.equal(refused.status, 1);
  assert.doesNotMatch(refused.stdout, /技能异常/u);
  assert.equal(unreportedEvents(root).length, 0);
  changeState(root, (state) => ({ ...state, milestones: 5 }));
  const broken = project(["status"]);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /- 脚本错误: /u);
  assert.match(broken.stdout, /- 技能异常: 这是技能脚本的内部错误/u);
  const events = unreportedEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, EVENT_KINDS.internalError);
  assert.equal(events[0].source, "status");
  assert.ok(events[0].stack.length > 0, "内部错误带调用栈");
});

test("下一动作被拒绝: 上一次下一动作要求运行的命令被流程规则拒绝时记下异常", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  mkdirSync(registryDirectory(root), { recursive: true });
  writeFileSync(
    path.join(registryDirectory(root), GUIDANCE_FILE),
    JSON.stringify({ action: "运行 order set issued", revision: 1, count: 1 }),
    "utf8",
  );
  const refused = project(["order", "set", "issued"]);
  assert.equal(refused.status, 1);
  assert.match(
    refused.stdout,
    /- 技能异常: 这条命令是上一次 "下一动作" 要求运行的/u,
  );
  assert.equal(unreportedEvents(root)[0].kind, EVENT_KINDS.refused);
});

test("hook 出错: 照常放行, 记下异常, 之后提醒编排会话上报", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { hook } = initializeProject(root);
  const transcript = writeTranscript(root, true);
  context.after(transcript.cleanup);
  const input = {
    hook_event_name: "UserPromptSubmit",
    transcript_path: transcript.path,
    prompt: "继续",
  };
  changeState(root, (state) => ({ ...state, milestones: 5 }));
  const failed = hook(input);
  assert.equal(failed.status, 0);
  assert.equal(failed.output, undefined);
  const events = unreportedEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, EVENT_KINDS.hookError);
  assert.equal(events[0].source, "UserPromptSubmit");
  changeState(root, (state) => ({ ...state, milestones: [] }));
  const reminded = hook(input);
  assert.match(
    reminded.output.hookSpecificOutput.additionalContext,
    /技能异常: 脚本记录到 1 条还没有上报的异常/u,
  );
});

test("问题报告: 没有异常也没有草稿时拒绝; 只有草稿时生成可继续的报告", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  const empty = project(["report"]);
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /没有可上报的内容/u);
  assert.doesNotMatch(empty.stdout, /技能异常/u);
  const draft = writeDraft(root, "report.json", {
    doing: "填写工单审阅",
    expected: "骨架通过自查",
    actual: "自查提示缺少一节",
    reproduce: "运行 reply approval 后运行 check",
  });
  const output = project(["report", "--from", draft]);
  assert.equal(output.status, 0);
  assert.match(
    output.stdout,
    /- 报告文件: \.navigator\/drafts\/reports\/report-0001\.md/u,
  );
  assert.match(output.stdout, /- 能否继续: 能/u);
  assert.match(output.stdout, /reply report --option 1/u);
  const report = readFileSync(
    path.join(root, ".navigator", "drafts", "reports", "report-0001.md"),
    "utf8",
  );
  assert.match(report, /## 脚本记录的异常\n\n无/u);
  assert.match(report, /- 实际结果: 自查提示缺少一节/u);
  assert.doesNotMatch(report, ADVICE_PATTERN);
  assert.equal(runIgnored(root), true, "报告在草稿目录中, 不入库");
});

test("问题报告: 带上脚本记录的异常, 隐去本机路径, 上报后不再重复", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  changeState(root, (state) => ({ ...state, milestones: 5 }));
  project(["status"]);
  changeState(root, (state) => ({ ...state, milestones: [] }));
  const output = project(["report"]);
  assert.equal(output.status, 0);
  assert.match(output.stdout, /- 能否继续: 不能/u);
  assert.match(output.stdout, /reply report --option 2/u);
  assert.match(output.stdout, /### 1\. 命令内部错误/u);
  assert.match(output.stdout, /- 来源: status/u);
  assert.match(output.stdout, /<技能目录>/u);
  assert.ok(!output.stdout.includes(root), "不含项目的本机路径");
  assert.ok(!output.stdout.includes("```"), "不含会破坏代码块的围栏");
  assert.doesNotMatch(output.stdout.split("报告全文:")[1], ADVICE_PATTERN);
  assert.equal(unreportedEvents(root).length, 0);
  assert.doesNotMatch(project(["status"]).stdout, /技能异常/u);
  assert.equal(project(["report"]).status, 1, "同一个问题只上报一次");
  const blocked = writeDraft(root, "blocked.json", {
    actual: "照下一动作做却走不通",
    blocked: true,
  });
  const second = project(["report", "--from", blocked]).stdout;
  assert.match(second, /report-0002\.md/u);
  assert.match(second, /- 能否继续: 不能/u);
});

/**
 * 判断报告目录是否被 Git 忽略.
 *
 * @param {string} root 项目根目录.
 * @returns {boolean} 被忽略时返回 true.
 */
function runIgnored(root) {
  return (
    readFileSync(path.join(root, ".navigator", ".gitignore"), "utf8").match(
      /drafts/u,
    ) !== null
  );
}
