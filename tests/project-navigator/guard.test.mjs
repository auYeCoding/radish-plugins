/**
 * @file 写入守卫的决策表测试: 四条规则各有放行例与拒绝例.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  SUBAGENT_TYPES,
  decideWrite,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs";

/**
 * 判定用的项目根目录; 守卫只做路径计算, 不访问文件.
 * @type {string}
 */
const ROOT = path.resolve("/项目 根");

/**
 * 当前工单的文件夹名.
 * @type {string}
 */
const FOLDER = "0007-export";

/**
 * 构造一张当前工单.
 *
 * @param {string} kind 工单类型.
 * @param {string} [status] 工单状态.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").OrderState} 工单.
 */
function orderOf(kind, status = "issued") {
  return {
    id: "0007",
    slug: "export",
    folder: FOLDER,
    kind,
    slice: null,
    status,
    round: 1,
    baseCommit: "a".repeat(40),
  };
}

/**
 * 判定一次写入.
 *
 * @param {object} options 参数.
 * @param {string} options.target 目标的项目相对路径.
 * @param {string} [options.agentType] 子代理类型; 省略时为主会话.
 * @param {boolean} [options.isOrchestrator] 主会话是否为编排会话.
 * @param {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").OrderState | null} [options.order] 当前工单.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs").GuardDecision} 判定.
 */
function decide({
  target,
  agentType,
  isOrchestrator = false,
  order = orderOf("implementation"),
}) {
  return decideWrite({
    projectRoot: ROOT,
    toolInput: { file_path: path.join(ROOT, target) },
    isSubagent: agentType !== undefined,
    agentType,
    order,
    isOrchestrator: () => isOrchestrator,
  });
}

test("守卫: 状态文件与生成的视图文件谁都不能直接写", () => {
  for (const target of [
    ".navigator/state.json",
    ".navigator/plan/roadmap.md",
    ".navigator/plan/risks.md",
  ]) {
    assert.equal(decide({ target, isOrchestrator: true }).decision, "deny");
    assert.equal(
      decide({ target, agentType: SUBAGENT_TYPES.executor }).decision,
      "deny",
    );
    assert.equal(decide({ target }).decision, "deny");
  }
});

test("守卫: 核对与验收子代理不能写任何项目文件", () => {
  for (const agentType of [SUBAGENT_TYPES.reviewer, SUBAGENT_TYPES.checker]) {
    assert.equal(decide({ target: "src/app.js", agentType }).decision, "deny");
  }
  assert.equal(
    decide({
      target: `.navigator/orders/${FOLDER}/order.md`,
      agentType: SUBAGENT_TYPES.checker,
    }).decision,
    "deny",
  );
  assert.equal(
    decide({
      target: `.navigator/orders/${FOLDER}/review.md`,
      agentType: SUBAGENT_TYPES.reviewer,
    }).decision,
    "deny",
  );
});

test("守卫: 执行子代理在 .navigator/ 下只能写本工单的回执与证据文件", () => {
  const executor = SUBAGENT_TYPES.executor;
  assert.equal(
    decide({
      target: `.navigator/orders/${FOLDER}/receipt.md`,
      agentType: executor,
    }).decision,
    "allow",
  );
  assert.equal(
    decide({
      target: `.navigator/orders/${FOLDER}/artifacts/capture.txt`,
      agentType: executor,
    }).decision,
    "allow",
  );
  assert.equal(
    decide({
      target: `.navigator/orders/${FOLDER}/order.md`,
      agentType: executor,
    }).decision,
    "deny",
  );
  assert.equal(
    decide({
      target: ".navigator/orders/0006-old/receipt.md",
      agentType: executor,
    }).decision,
    "deny",
  );
});

test("守卫: 执行子代理在工单执行中可以写业务文件与项目配置", () => {
  const executor = SUBAGENT_TYPES.executor;
  assert.equal(
    decide({ target: "src/app.js", agentType: executor }).decision,
    "allow",
  );
  assert.equal(
    decide({ target: ".claude/settings.json", agentType: executor }).decision,
    "allow",
  );
});

test("守卫: 工单不在执行中时, 执行子代理不能写业务文件", () => {
  const executor = SUBAGENT_TYPES.executor;
  for (const order of [null, orderOf("implementation", "reviewing")]) {
    const decision = decide({
      target: "src/app.js",
      agentType: executor,
      order,
    });
    assert.equal(decision.decision, "deny");
    assert.match(decision.reason ?? "", /不在执行中/u);
  }
});

test("守卫: 运行检查与分析工单的执行子代理不能写业务文件, 理由指向实现工单", () => {
  const executor = SUBAGENT_TYPES.executor;
  for (const kind of ["runcheck", "analysis"]) {
    const decision = decide({
      target: "src/app.js",
      agentType: executor,
      order: orderOf(kind),
    });
    assert.equal(decision.decision, "deny");
    assert.match(decision.reason ?? "", /实现工单/u);
    assert.equal(
      decide({
        target: `.navigator/orders/${FOLDER}/artifacts/notes.md`,
        agentType: executor,
        order: orderOf(kind),
      }).decision,
      "allow",
    );
  }
});

test("守卫: 编排会话只能写 .navigator/ 下的记录", () => {
  assert.equal(
    decide({ target: "src/app.js", isOrchestrator: true }).decision,
    "deny",
  );
  assert.equal(
    decide({ target: ".claude/settings.json", isOrchestrator: true }).decision,
    "deny",
  );
  assert.equal(
    decide({ target: ".navigator/plan/brief.md", isOrchestrator: true })
      .decision,
    "allow",
  );
  assert.equal(
    decide({ target: ".navigator/drafts/roadmap.json", isOrchestrator: true })
      .decision,
    "allow",
  );
});

test("守卫: 其它会话与其它子代理不受限制, 项目之外的写入不受限制", () => {
  assert.equal(decide({ target: "src/app.js" }).decision, "allow");
  assert.equal(
    decide({ target: "src/app.js", agentType: "general-purpose" }).decision,
    "allow",
  );
  const outside = decideWrite({
    projectRoot: ROOT,
    toolInput: { file_path: path.resolve("/别处/notes.md") },
    isSubagent: false,
    agentType: undefined,
    order: null,
    isOrchestrator: () => true,
  });
  assert.equal(outside.decision, "allow");
});

test("守卫: 只有需要时才判断是否为编排会话", () => {
  let calls = 0;
  decideWrite({
    projectRoot: ROOT,
    toolInput: { file_path: path.join(ROOT, ".navigator/plan/brief.md") },
    isSubagent: false,
    agentType: undefined,
    order: null,
    isOrchestrator: () => {
      calls += 1;
      return true;
    },
  });
  assert.equal(calls, 0);
});
