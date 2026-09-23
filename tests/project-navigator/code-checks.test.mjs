/**
 * @file 代码检查测试: 登记, 固定判据, 发布前核对, 可运行的测试命令与骨架预填.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CRITERIA_SECTION,
  codeCheckCriterion,
  issueBlocker,
  orderSkeletonPrefills,
  orderTestCommands,
  registerCodeChecks,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/code-checks.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { createInitialState } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { WorkflowError } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-error.mjs";
import {
  authorizeTests,
  createOrder,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-orders.mjs";

/**
 * 测试用的时间.
 * @type {string}
 */
const NOW = "2026-09-23T00:00:00.000Z";

/**
 * 测试用的检查命令.
 * @type {readonly string[]}
 */
const COMMANDS = Object.freeze(["ruff check .", "ruff format --check ."]);

/**
 * 建立带一张当前工单的状态.
 *
 * @param {string} kind 工单类型.
 * @param {string[] | undefined} commands 已登记的检查命令; undefined 表示尚未登记.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 状态.
 */
function stateWithOrder(kind, commands) {
  const initial = createInitialState({
    skillVersion: "0.1.0",
    sessionId: "s",
    now: NOW,
  });
  const registered =
    commands === undefined
      ? initial
      : registerCodeChecks(initial, { commands, reason: "不适用" });
  return createOrder(registered, {
    kind,
    slug: "demo",
    slice: undefined,
    baseCommit: "a".repeat(40),
  });
}

/**
 * 生成只含验收判据一节的工单文字.
 *
 * @param {string[]} criteria 判据各行.
 * @returns {string} 工单文字.
 */
function orderText(criteria) {
  return ["# 执行工单", "", `## ${CRITERIA_SECTION}`, "", ...criteria, ""].join(
    "\n",
  );
}

test("代码检查: 判据节的标题与规格中的工单节一致", () => {
  const titles = loadSpec().files.order.sections.map(
    (section) => section.title,
  );
  assert.ok(titles.includes(CRITERIA_SECTION));
});

test("代码检查: 登记时去掉空白与重复, 有命令时不保留原因", () => {
  const state = registerCodeChecks(
    stateWithOrder("implementation", undefined),
    {
      commands: [" ruff check . ", "ruff check .", ""],
      reason: "多余",
    },
  );
  assert.deepEqual(state.codeChecks, {
    commands: ["ruff check ."],
    reason: null,
  });
});

test("代码检查: 没有命令时必须写原因", () => {
  const state = stateWithOrder("implementation", undefined);
  assert.throws(
    () => registerCodeChecks(state, { commands: [], reason: " " }),
    WorkflowError,
  );
  assert.deepEqual(
    registerCodeChecks(state, { commands: [], reason: "纯文档项目" })
      .codeChecks,
    { commands: [], reason: "纯文档项目" },
  );
});

test("代码检查: 选型工单不需要检查判据", () => {
  assert.equal(
    issueBlocker(stateWithOrder("selection", undefined), ""),
    undefined,
  );
});

test("代码检查: 实现工单在登记检查命令之前不能发布", () => {
  const blocker = issueBlocker(stateWithOrder("implementation", undefined), "");
  assert.match(blocker ?? "", /codecheck set/u);
});

test("代码检查: 登记为没有命令时, 实现工单可以发布", () => {
  assert.equal(issueBlocker(stateWithOrder("fix", []), ""), undefined);
});

test("代码检查: 验收判据中缺少检查判据时不能发布", () => {
  const state = stateWithOrder("implementation", [...COMMANDS]);
  const criterion = codeCheckCriterion(COMMANDS);
  assert.match(
    issueBlocker(state, orderText(["1. 页面能打开."])) ?? "",
    /缺少代码检查判据/u,
  );
  assert.equal(
    issueBlocker(state, orderText([`1. ${criterion}`, "2. 页面能打开."])),
    undefined,
  );
  const elsewhere = [
    "# 执行工单",
    "",
    "## 执行守则",
    "",
    criterion,
    "",
    `## ${CRITERIA_SECTION}`,
    "",
    "1. 页面能打开.",
  ].join("\n");
  assert.match(
    issueBlocker(state, elsewhere) ?? "",
    /缺少代码检查判据/u,
    "判据写在其它节不算",
  );
});

test("代码检查: 检查命令算作当前工单可运行的测试, 并与授权测试去重", () => {
  const state = authorizeTests(
    stateWithOrder("implementation", [...COMMANDS]),
    ["pytest", "ruff check ."],
  );
  assert.deepEqual(orderTestCommands(state), [...COMMANDS, "pytest"]);
  assert.deepEqual(
    orderTestCommands(
      authorizeTests(stateWithOrder("selection", [...COMMANDS]), ["pytest"]),
    ),
    ["pytest"],
  );
});

test("代码检查: 实现工单的骨架预填检查判据, 选型工单不预填", () => {
  assert.deepEqual(
    orderSkeletonPrefills(stateWithOrder("implementation", [...COMMANDS])),
    { [CRITERIA_SECTION]: [`1. ${codeCheckCriterion(COMMANDS)}`] },
  );
  assert.deepEqual(
    orderSkeletonPrefills(stateWithOrder("selection", [...COMMANDS])),
    {},
  );
  assert.deepEqual(orderSkeletonPrefills(undefined), {});
});
