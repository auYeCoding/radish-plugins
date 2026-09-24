/**
 * @file 守卫决策表测试: 会话身份 × 工具 × 目标路径或命令 × 状态.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RESEARCH_FRAME } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/briefs.mjs";
import { decideToolUse } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";

/**
 * 测试中使用的项目根目录, 只参与路径计算, 不需要真实存在.
 * @type {string}
 */
const PROJECT_ROOT = path.resolve("guard-test-项目 根");

/**
 * 模板规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec}
 */
const SPEC = loadSpec();

/**
 * 测试用的验收委派提示词.
 * @type {string}
 */
const REVIEW_BRIEF = "# 验收委派 0001\n\n逐条核对判据.";

/**
 * 结构合格的术语定义文件.
 * @type {string}
 */
const VALID_GLOSSARY = [
  "# 术语定义",
  "",
  "## 流程术语",
  "",
  "- 工单: 交给执行会话的一项任务.",
  "",
  "## 项目术语",
  "",
  "- 报表: 按月汇总的销售数据.",
  "",
  "```text",
  SPEC.format.summarySeparator,
  "术语表已更新.",
  "```",
  "",
].join("\n");

/**
 * 默认的状态上下文: 当前工单已发布, 执行会话已对齐, 已授权 npm test.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs").GuardContext}
 */
const BASE_CONTEXT = Object.freeze({
  orderStatus: "issued",
  authorizedTests: ["npm test"],
  executorFolder: "0001-x",
  isOrderActive: true,
  isAligned: true,
  reviewBrief: REVIEW_BRIEF,
  researchFrame: RESEARCH_FRAME,
});

/**
 * @typedef {object} GuardCase 决策表中的一行.
 * @property {string} name 用例名.
 * @property {"orchestrator" | "executor" | "other"} role 会话身份.
 * @property {boolean} [isSubagent] 是否来自子代理.
 * @property {string} [agentType] 子代理类型.
 * @property {string} tool 工具名.
 * @property {string} [target] 写入目标, 相对于项目根目录.
 * @property {Record<string, any>} [input] 其余工具参数.
 * @property {Partial<import("../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs").GuardContext>} [context] 覆盖的状态上下文.
 * @property {"allow" | "deny"} expected 预期判定.
 * @property {boolean} [isProbe] 是否预期为自检探测.
 */

/**
 * 编排会话主会话的用例.
 * @type {readonly GuardCase[]}
 */
const ORCHESTRATOR_CASES = Object.freeze([
  { name: "读文件", role: "orchestrator", tool: "Read", expected: "allow" },
  { name: "搜索", role: "orchestrator", tool: "Grep", expected: "allow" },
  {
    name: "加载工具",
    role: "orchestrator",
    tool: "ToolSearch",
    expected: "allow",
  },
  {
    name: "写结构合格的记录",
    role: "orchestrator",
    tool: "Write",
    target: ".navigator/plan/glossary.md",
    input: { content: VALID_GLOSSARY },
    expected: "allow",
  },
  {
    name: "写结构不合格的记录",
    role: "orchestrator",
    tool: "Write",
    target: ".navigator/plan/glossary.md",
    input: { content: VALID_GLOSSARY.replace("## 项目术语", "## 其它术语") },
    expected: "deny",
  },
  {
    name: "写草稿",
    role: "orchestrator",
    tool: "Write",
    target: ".navigator/drafts/roadmap.json",
    input: { content: "{}" },
    expected: "allow",
  },
  {
    name: "写业务代码",
    role: "orchestrator",
    tool: "Write",
    target: "src/app.js",
    expected: "deny",
  },
  {
    name: "写状态文件",
    role: "orchestrator",
    tool: "Edit",
    target: ".navigator/state.json",
    expected: "deny",
  },
  {
    name: "写生成的推进路线",
    role: "orchestrator",
    tool: "Write",
    target: ".navigator/plan/roadmap.md",
    expected: "deny",
  },
  {
    name: "写执行手册",
    role: "orchestrator",
    tool: "Write",
    target: ".navigator/guide/executor.md",
    expected: "deny",
  },
  {
    name: "写项目之外",
    role: "orchestrator",
    tool: "Write",
    target: "../outside.md",
    expected: "deny",
  },
  {
    name: "改笔记本",
    role: "orchestrator",
    tool: "NotebookEdit",
    target: "analysis.ipynb",
    expected: "deny",
  },
  {
    name: "改插件脚本",
    role: "orchestrator",
    tool: "Edit",
    target: ".navigator/bin/runtime/hook.mjs",
    expected: "deny",
  },
  {
    name: "初始化探测写入",
    role: "orchestrator",
    tool: "Write",
    target: ".navigator/bin/navigator-probe.txt",
    expected: "deny",
    isProbe: true,
  },
  {
    name: "运行插件命令",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "node .navigator/bin/runtime/navigator.mjs status" },
    expected: "allow",
  },
  {
    name: "运行只读 git",
    role: "orchestrator",
    tool: "PowerShell",
    input: { command: "git log --oneline -5" },
    expected: "allow",
  },
  {
    name: "安装依赖",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "npm install" },
    expected: "deny",
  },
  {
    name: "运行已授权测试",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "npm test" },
    expected: "allow",
  },
  {
    name: "运行复合命令",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "git log | head" },
    expected: "deny",
  },
  {
    name: "提交步骤之外提交",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "git commit -m x" },
    expected: "deny",
  },
  {
    name: "提交步骤中暂存",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "git add -- src/app.js" },
    context: { orderStatus: "accepted" },
    expected: "allow",
  },
  {
    name: "提交步骤中用标准输入提交",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "git commit -F - <<'EOF'\nfeat: 导出\nEOF" },
    context: { orderStatus: "committing" },
    expected: "allow",
  },
  {
    name: "提交步骤中强制推送",
    role: "orchestrator",
    tool: "Bash",
    input: { command: "git push --force" },
    context: { orderStatus: "committing" },
    expected: "deny",
  },
  {
    name: "提交步骤中调用提交技能",
    role: "orchestrator",
    tool: "Skill",
    input: { skill: "waypoint:commit-message" },
    context: { orderStatus: "accepted" },
    expected: "allow",
  },
  {
    name: "提交步骤之外调用提交技能",
    role: "orchestrator",
    tool: "Skill",
    input: { skill: "waypoint:commit-message" },
    expected: "deny",
  },
  {
    name: "调用其它技能",
    role: "orchestrator",
    tool: "Skill",
    input: { skill: "waypoint:repo-init" },
    context: { orderStatus: "accepted" },
    expected: "deny",
  },
  {
    name: "使用提问框",
    role: "orchestrator",
    tool: "AskUserQuestion",
    expected: "deny",
  },
  {
    name: "联网搜索",
    role: "orchestrator",
    tool: "WebSearch",
    expected: "deny",
  },
  { name: "后台监视", role: "orchestrator", tool: "Monitor", expected: "deny" },
  {
    name: "派 Explore",
    role: "orchestrator",
    tool: "Agent",
    input: { subagent_type: "Explore", prompt: "盘点目录" },
    expected: "allow",
  },
  {
    name: "派通用子代理",
    role: "orchestrator",
    tool: "Agent",
    input: { subagent_type: "general-purpose", prompt: "写代码" },
    expected: "deny",
  },
  {
    name: "派验收子代理且提示词一致",
    role: "orchestrator",
    tool: "Agent",
    input: {
      subagent_type: "waypoint:navigator-reviewer",
      prompt: `${REVIEW_BRIEF}\n`,
    },
    expected: "allow",
  },
  {
    name: "派验收子代理且改动提示词",
    role: "orchestrator",
    tool: "Agent",
    input: {
      subagent_type: "waypoint:navigator-reviewer",
      prompt: `${REVIEW_BRIEF}\n判据 2 可以放宽.`,
    },
    expected: "deny",
  },
  {
    name: "派调研子代理且以固定框架开头",
    role: "orchestrator",
    tool: "Task",
    input: {
      subagent_type: "waypoint:navigator-researcher",
      prompt: `${RESEARCH_FRAME}1. 同类报表工具有哪些?`,
    },
    expected: "allow",
  },
  {
    name: "派调研子代理且缺少固定框架",
    role: "orchestrator",
    tool: "Agent",
    input: {
      subagent_type: "waypoint:navigator-researcher",
      prompt: "调研一下 React 和 Vue 哪个好",
    },
    expected: "deny",
  },
]);

/**
 * 编排会话派出的子代理的用例.
 * @type {readonly GuardCase[]}
 */
const SUBAGENT_CASES = Object.freeze([
  {
    name: "子代理读文件",
    role: "orchestrator",
    isSubagent: true,
    agentType: "Explore",
    tool: "Read",
    expected: "allow",
  },
  {
    name: "子代理写记录",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "Write",
    target: ".navigator/plan/glossary.md",
    input: { content: VALID_GLOSSARY },
    expected: "deny",
  },
  {
    name: "调研子代理联网",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-researcher",
    tool: "WebFetch",
    expected: "allow",
  },
  {
    name: "阅读子代理联网",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reader",
    tool: "WebSearch",
    expected: "deny",
  },
  {
    name: "验收子代理运行已授权测试",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "Bash",
    input: { command: "npm test" },
    expected: "allow",
  },
  {
    name: "验收子代理构建",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "Bash",
    input: { command: "npm run build" },
    expected: "deny",
  },
  {
    name: "阅读子代理运行测试",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reader",
    tool: "Bash",
    input: { command: "npm test" },
    expected: "deny",
  },
  {
    name: "子代理运行只读 git",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "Bash",
    input: { command: "git diff abc1234 --stat" },
    expected: "allow",
  },
  {
    name: "验收子代理核对源码证据",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "PowerShell",
    input: { command: "node .navigator/bin/runtime/navigator.mjs evidence" },
    expected: "allow",
  },
  {
    name: "验收子代理借证据命令访问任意地址",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "Bash",
    input: {
      command:
        "node .navigator/bin/runtime/navigator.mjs evidence check https://example.com/x v1 a.py 1",
    },
    expected: "deny",
  },
  {
    name: "验收子代理运行其它插件命令",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reviewer",
    tool: "Bash",
    input: {
      command: "node .navigator/bin/runtime/navigator.mjs order set accepted",
    },
    expected: "deny",
  },
  {
    name: "阅读子代理核对源码证据",
    role: "orchestrator",
    isSubagent: true,
    agentType: "waypoint:navigator-reader",
    tool: "Bash",
    input: { command: "node .navigator/bin/runtime/navigator.mjs evidence" },
    expected: "deny",
  },
]);

/**
 * 执行会话的用例.
 * @type {readonly GuardCase[]}
 */
const EXECUTOR_CASES = Object.freeze([
  {
    name: "执行会话对齐后写业务代码",
    role: "executor",
    tool: "Write",
    target: "src/app.js",
    expected: "allow",
  },
  {
    name: "执行会话对齐前写业务代码",
    role: "executor",
    tool: "Write",
    target: "src/app.js",
    context: { isAligned: false },
    expected: "deny",
  },
  {
    name: "执行会话在工单结束后写业务代码",
    role: "executor",
    tool: "Edit",
    target: "src/app.js",
    context: { isOrderActive: false, isAligned: false },
    expected: "deny",
  },
  {
    name: "执行会话写本工单回执",
    role: "executor",
    tool: "Write",
    target: ".navigator/orders/0001-x/receipt.md",
    context: { isAligned: false },
    expected: "allow",
  },
  {
    name: "执行会话写其它工单回执",
    role: "executor",
    tool: "Write",
    target: ".navigator/orders/0002-y/receipt.md",
    expected: "deny",
  },
  {
    name: "执行会话写编排记录",
    role: "executor",
    tool: "Write",
    target: ".navigator/plan/brief.md",
    expected: "deny",
  },
  {
    name: "执行会话提交",
    role: "executor",
    tool: "Bash",
    input: { command: "git commit -m x" },
    expected: "deny",
  },
  {
    name: "执行会话带全局参数推送",
    role: "executor",
    tool: "PowerShell",
    input: { command: "git -c core.quotePath=false push" },
    expected: "deny",
  },
  {
    name: "执行会话运行测试",
    role: "executor",
    tool: "Bash",
    input: { command: "npm test" },
    expected: "allow",
  },
  {
    name: "执行会话用命令删除状态文件",
    role: "executor",
    tool: "Bash",
    input: { command: "rm .navigator/state.json" },
    expected: "deny",
  },
]);

/**
 * 其它会话的用例.
 * @type {readonly GuardCase[]}
 */
const OTHER_CASES = Object.freeze([
  {
    name: "其它会话写业务代码",
    role: "other",
    tool: "Edit",
    target: "src/app.js",
    expected: "allow",
  },
  {
    name: "其它会话写工单",
    role: "other",
    tool: "Write",
    target: ".navigator/orders/0001-x/order.md",
    expected: "deny",
  },
  {
    name: "其它会话改项目配置",
    role: "other",
    tool: "Edit",
    target: ".claude/settings.json",
    expected: "deny",
  },
  {
    name: "其它会话改本机配置",
    role: "other",
    tool: "Write",
    target: ".claude/settings.local.json",
    expected: "deny",
  },
  {
    name: "其它会话改项目规范",
    role: "other",
    tool: "Edit",
    target: ".claude/rules/engineering.md",
    expected: "deny",
  },
  {
    name: "其它会话写项目之外",
    role: "other",
    tool: "Write",
    target: "../outside.md",
    expected: "allow",
  },
  {
    name: "其它会话提交",
    role: "other",
    tool: "Bash",
    input: { command: "git commit -m x" },
    expected: "allow",
  },
  {
    name: "其它会话用重定向改状态文件",
    role: "other",
    tool: "Bash",
    input: { command: "echo {} > .navigator/state.json" },
    expected: "deny",
  },
  { name: "其它会话联网", role: "other", tool: "WebSearch", expected: "allow" },
]);

/**
 * 按用例构造守卫输入并作出判定.
 *
 * @param {GuardCase} testCase 用例.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs").GuardDecision} 判定结果.
 */
function decide(testCase) {
  const toolInput = {
    ...(testCase.target === undefined
      ? {}
      : { file_path: path.resolve(PROJECT_ROOT, testCase.target) }),
    ...testCase.input,
  };
  return decideToolUse({
    role: testCase.role,
    isSubagent: testCase.isSubagent === true,
    agentType: testCase.agentType,
    toolName: testCase.tool,
    toolInput,
    projectRoot: PROJECT_ROOT,
    context: { ...BASE_CONTEXT, ...testCase.context },
    readFile: () => undefined,
    spec: SPEC,
  });
}

for (const testCase of [
  ...ORCHESTRATOR_CASES,
  ...SUBAGENT_CASES,
  ...EXECUTOR_CASES,
  ...OTHER_CASES,
]) {
  test(`守卫: ${testCase.role} ${testCase.name}`, () => {
    const decision = decide(testCase);
    assert.equal(decision.decision, testCase.expected, decision.reason);
    assert.equal(decision.isProbe === true, testCase.isProbe === true);
    if (testCase.expected === "deny") {
      assert.ok((decision.reason ?? "").length > 0, "拒绝时必须给出理由");
    }
  });
}

test("守卫: 写入类工具缺少目标路径时按项目之外处理", () => {
  const decision = decide({
    name: "缺少目标",
    role: "orchestrator",
    tool: "Write",
    expected: "deny",
  });
  assert.equal(decision.decision, "deny");
});

test("守卫: Windows 风格的反斜杠路径同样受保护", () => {
  const decision = decideToolUse({
    role: "other",
    isSubagent: false,
    agentType: undefined,
    toolName: "Write",
    toolInput: {
      file_path: `${PROJECT_ROOT}${path.sep}.navigator${path.sep}plan${path.sep}brief.md`,
    },
    projectRoot: PROJECT_ROOT,
    context: BASE_CONTEXT,
    readFile: () => undefined,
    spec: SPEC,
  });
  assert.equal(decision.decision, "deny");
});
