/**
 * @file 工作流纯函数测试: 工单状态, 推进路线, 记录, 会话登记, 执行会话对齐与下一动作.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLaunchPrompt } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/briefs.mjs";
import {
  applyAlignmentAnswer,
  executorGuardState,
  findLaunchedOrder,
  isAlignmentConfirmed,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/executors.mjs";
import { nextAction } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/guidance.mjs";
import {
  claimSession,
  isOrchestratorSession,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/sessions.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { createInitialState } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { WorkflowError } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-error.mjs";
import {
  adoptCommit,
  authorizeTests,
  consecutiveRejections,
  createOrder,
  setOrderStatus,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-orders.mjs";
import {
  applyRoadmap,
  enterStage,
  setProgressStatus,
  skipStage,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-plan.mjs";
import {
  addCheckup,
  addDecision,
  addRisk,
  setRiskStatus,
  supersedeDecision,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-records.mjs";

/**
 * 测试用的时间.
 * @type {string}
 */
const NOW = "2026-09-23T00:00:00.000Z";

/**
 * 最后一个阶段的编号.
 * @type {number}
 */
const LAST_STAGE = 6;

/**
 * 测试用的提交哈希.
 * @type {Readonly<Record<string, string>>}
 */
const COMMITS = Object.freeze({
  base: "a".repeat(40),
  next: "b".repeat(40),
});

/**
 * 创建一份带一个里程与两个切片的状态.
 *
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 状态.
 */
function stateWithRoadmap() {
  const initial = createInitialState({
    skillVersion: "0.1.0",
    sessionId: "orchestrator-1",
    now: NOW,
  });
  return applyRoadmap(enterStage(initial, 5, LAST_STAGE), {
    milestones: [
      {
        name: "导出报表",
        goal: "能导出月报",
        metrics: ["导出成功"],
        slices: [{ name: "导出 CSV" }, { name: "导出 PDF" }],
      },
    ],
  });
}

/**
 * 创建一份当前工单已发布的状态.
 *
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 状态.
 */
function stateWithIssuedOrder() {
  const drafted = createOrder(stateWithRoadmap(), {
    kind: "implementation",
    slug: "export-csv",
    slice: "0001",
    baseCommit: COMMITS.base,
  });
  return setOrderStatus(drafted, "issued", COMMITS.base);
}

test("工单: 新建后为起草状态, 文件夹名为编号加短名", () => {
  const state = createOrder(stateWithRoadmap(), {
    kind: "implementation",
    slug: "export-csv",
    slice: "0001",
    baseCommit: COMMITS.base,
  });
  assert.equal(state.order.folder, "0001-export-csv");
  assert.equal(state.order.status, "drafting");
  assert.equal(state.order.round, 0);
});

test("工单: 严格串行, 未结束时不能新建", () => {
  assert.throws(
    () =>
      createOrder(stateWithIssuedOrder(), {
        kind: "fix",
        slug: "fix-csv",
        slice: undefined,
        baseCommit: COMMITS.base,
      }),
    WorkflowError,
  );
});

test("工单: 类型, 短名与切片编号必须合法", () => {
  const base = stateWithRoadmap();
  const options = {
    kind: "implementation",
    slug: "export-csv",
    slice: undefined,
    baseCommit: COMMITS.base,
  };
  assert.throws(
    () => createOrder(base, { ...options, kind: "deploy" }),
    WorkflowError,
  );
  assert.throws(
    () => createOrder(base, { ...options, slug: "导出" }),
    WorkflowError,
  );
  assert.throws(
    () => createOrder(base, { ...options, slice: "0099" }),
    WorkflowError,
  );
});

test("工单: 每次发布轮次加一, 不允许跳过状态", () => {
  const issued = stateWithIssuedOrder();
  assert.equal(issued.order.round, 1);
  const reissued = setOrderStatus(
    setOrderStatus(issued, "blocked", COMMITS.base),
    "issued",
    COMMITS.base,
  );
  assert.equal(reissued.order.round, 2);
  assert.throws(
    () => setOrderStatus(issued, "committed", COMMITS.next),
    WorkflowError,
  );
});

test("工单: 提交后移入历史, 记录最近提交与切片工单", () => {
  const accepted = setOrderStatus(
    setOrderStatus(stateWithIssuedOrder(), "reviewing", COMMITS.base),
    "accepted",
    COMMITS.base,
  );
  const committed = setOrderStatus(accepted, "committed", COMMITS.next);
  assert.equal(committed.order, null);
  assert.equal(committed.lastCommit, COMMITS.next);
  assert.deepEqual(committed.orders.at(-1).status, "committed");
  assert.deepEqual(
    committed.slices.find((slice) => slice.id === "0001").orders,
    ["0001"],
  );
});

test("工单: 同一切片连续验收不通过的次数", () => {
  const reject = (state, slug) =>
    setOrderStatus(
      setOrderStatus(
        setOrderStatus(
          createOrder(state, {
            kind: "fix",
            slug,
            slice: "0001",
            baseCommit: COMMITS.base,
          }),
          "issued",
          COMMITS.base,
        ),
        "reviewing",
        COMMITS.base,
      ),
      "rejected",
      COMMITS.base,
    );
  const twice = reject(reject(stateWithRoadmap(), "first"), "second");
  assert.equal(consecutiveRejections(twice, "0001"), 2);
  assert.equal(consecutiveRejections(twice, "0002"), 0);
});

test("工单: 纳入提交时, 正在提交的工单视为已提交", () => {
  const committing = setOrderStatus(
    setOrderStatus(
      setOrderStatus(stateWithIssuedOrder(), "reviewing", COMMITS.base),
      "accepted",
      COMMITS.base,
    ),
    "committing",
    COMMITS.base,
  );
  const adopted = adoptCommit(committing, COMMITS.next, "纳入提交");
  assert.equal(adopted.order, null);
  assert.equal(adopted.lastCommit, COMMITS.next);
  const plain = adoptCommit(stateWithIssuedOrder(), COMMITS.next, "纳入提交");
  assert.equal(plain.order.status, "issued");
  assert.equal(plain.lastCommit, COMMITS.next);
});

test("工单: 授权测试命令去掉空行与首尾空白", () => {
  const state = authorizeTests(stateWithIssuedOrder(), [" npm test ", ""]);
  assert.deepEqual(state.order.authorizedTests, ["npm test"]);
});

test("路线: 带编号的条目保留状态, 新条目分配编号", () => {
  const active = setProgressStatus(
    stateWithRoadmap(),
    "slice",
    "0001",
    "active",
  );
  assert.equal(active.slice, "0001");
  const updated = applyRoadmap(active, {
    milestones: [
      {
        id: "0001",
        name: "导出报表",
        goal: "能导出月报",
        metrics: [],
        slices: [{ id: "0001", name: "导出 CSV" }, { name: "导出 Excel" }],
      },
    ],
  });
  assert.equal(updated.slices[0].status, "active");
  assert.equal(updated.slices[1].id, "0003");
  assert.throws(
    () =>
      applyRoadmap(active, {
        milestones: [{ id: "0009", name: "甲", goal: "乙", slices: [] }],
      }),
    WorkflowError,
  );
});

test("阶段: 跳过必须写明原因, 编号必须在范围内", () => {
  const state = stateWithRoadmap();
  assert.throws(
    () => skipStage(state, 0, " ", { lastStage: LAST_STAGE, now: NOW }),
    WorkflowError,
  );
  assert.throws(
    () => enterStage(state, LAST_STAGE + 1, LAST_STAGE),
    WorkflowError,
  );
  const skipped = skipStage(state, 0, "新项目没有已有代码", {
    lastStage: LAST_STAGE,
    now: NOW,
  });
  assert.equal(skipped.skipped[0].reason, "新项目没有已有代码");
});

test("记录: 风险, 决策与体检编号各自连续", () => {
  const withRisk = addRisk(stateWithRoadmap(), {
    description: "第三方接口限流",
    severity: "high",
    source: "调研报告",
  });
  assert.equal(withRisk.risks[0].id, "0001");
  assert.equal(
    setRiskStatus(withRisk, "0001", "resolved", "已加缓存").risks[0].handling,
    "已加缓存",
  );
  assert.throws(
    () => setRiskStatus(withRisk, "0002", "resolved", undefined),
    WorkflowError,
  );
  const decisions = addDecision(addDecision(withRisk, "选用 A"), "改用 B");
  const superseded = supersedeDecision(decisions, "0001", "0002");
  assert.equal(superseded.decisions[0].status, "superseded");
  const first = addCheckup(superseded);
  const second = addCheckup(first.state);
  assert.deepEqual([first.id, second.id], ["0001", "0002"]);
});

test("会话: 接管编排时原编排会话记入曾经的编排会话", () => {
  const state = stateWithRoadmap();
  const taken = claimSession(state, "orchestrator-2", NOW);
  assert.equal(taken.session.id, "orchestrator-2");
  assert.ok(isOrchestratorSession(taken, "orchestrator-1"));
  assert.ok(!isOrchestratorSession(taken, "executor-1"));
  assert.equal(claimSession(taken, "orchestrator-2", NOW), taken);
});

test("执行: 只有当前已发布的工单能被启动提示词登记", () => {
  const issued = stateWithIssuedOrder();
  const prompt = buildLaunchPrompt(issued.order);
  assert.equal(findLaunchedOrder(issued, prompt).order?.id, "0001");
  assert.deepEqual(findLaunchedOrder(issued, "你好"), {});
  assert.ok(findLaunchedOrder(issued, "执行工单 0002.").problem !== undefined);
  const drafting = createOrder(stateWithRoadmap(), {
    kind: "implementation",
    slug: "export-csv",
    slice: undefined,
    baseCommit: COMMITS.base,
  });
  assert.ok(findLaunchedOrder(drafting, prompt).problem !== undefined);
});

test("执行: 对齐只对本轮发布有效", () => {
  const issued = stateWithIssuedOrder();
  const record = {
    sessionId: "executor-1",
    order: "0001",
    folder: "0001-export-csv",
    registeredAt: NOW,
    isAligned: false,
    isAwaitingAlignment: true,
  };
  assert.equal(executorGuardState(record, issued).isAligned, false);
  const aligned = applyAlignmentAnswer(record, issued, "A");
  assert.equal(executorGuardState(aligned, issued).isAligned, true);
  const reissued = setOrderStatus(
    setOrderStatus(issued, "blocked", COMMITS.base),
    "issued",
    COMMITS.base,
  );
  assert.equal(executorGuardState(aligned, reissued).isAligned, false);
  const reviewing = setOrderStatus(issued, "reviewing", COMMITS.base);
  assert.equal(executorGuardState(aligned, reviewing).isOrderActive, false);
  const described = applyAlignmentAnswer(record, issued, "B. 判据 2 看不懂");
  assert.equal(described.isAligned, false);
  assert.equal(described.isAwaitingAlignment, false);
});

test("执行: 识别用户选择 A", () => {
  assert.ok(isAlignmentConfirmed("A"));
  assert.ok(isAlignmentConfirmed(" a. "));
  assert.ok(isAlignmentConfirmed("继续执行"));
  assert.ok(!isAlignmentConfirmed("Also"));
  assert.ok(!isAlignmentConfirmed("B"));
});

test("下一动作: 按对账结果与工单状态给出", () => {
  const consistent = {
    kind: "consistent",
    recorded: null,
    head: undefined,
    commits: [],
    files: [],
  };
  const base = {
    reconciliation: consistent,
    hasReceipt: false,
    isNewSession: false,
    restoreTarget: undefined,
    spec: loadSpec(),
  };
  const fresh = createInitialState({
    skillVersion: "0.1.0",
    sessionId: "s",
    now: NOW,
  });
  assert.match(
    nextAction({ ...base, state: fresh }),
    /回复 "首次接入" \(reply entry\)/u,
  );
  const issued = stateWithIssuedOrder();
  assert.match(
    nextAction({ ...base, state: issued, isNewSession: true }),
    /恢复进度/u,
  );
  assert.match(
    nextAction({ ...base, state: issued }),
    /等待工单 0001 的回执: 回复 "等待回执" \(reply wait\)/u,
  );
  assert.match(
    nextAction({ ...base, state: issued, hasReceipt: true }),
    /已有回执/u,
  );
  assert.match(
    nextAction({
      ...base,
      state: issued,
      reconciliation: { ...consistent, kind: "rollback" },
      restoreTarget: COMMITS.base,
    }),
    /验收异常", 使用第 1 组选项 \(reply anomaly --option 1\).+restore aaaaaaa/u,
  );
  assert.match(
    nextAction({
      ...base,
      state: issued,
      reconciliation: { ...consistent, kind: "squash" },
    }),
    /使用第 2 组选项.+adopt/u,
  );
  assert.match(
    nextAction({
      ...base,
      state: issued,
      reconciliation: { ...consistent, kind: "mismatch" },
    }),
    /使用第 3 组选项.+没有可用的恢复来源/u,
  );
});
