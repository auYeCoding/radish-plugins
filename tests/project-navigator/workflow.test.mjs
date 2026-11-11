/**
 * @file 工作流纯函数测试: 工单状态, 路线, 阶段, 记录, 状态迁移, 编排标记, 选项识别,
 * 验收结论分类, 委派提示词与下一动作.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildExecutorBrief,
  buildReviewBrief,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/briefs.mjs";
import { nextAction } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/guidance.mjs";
import { isChoiceSelected } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/option-answer.mjs";
import { APPROVAL_STATUSES } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/order-approval.mjs";
import {
  isOrchestratorTranscript,
  orchestratorMarker,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/orchestrator-marker.mjs";
import {
  classifyVerdicts,
  criteriaTableSpec,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/review-record.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import {
  STATE_SCHEMA_VERSION,
  createInitialState,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { WorkflowError } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-error.mjs";
import {
  consecutiveRejections,
  createOrder,
  setOrderStatus,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-orders.mjs";
import {
  FINISHED_STEP,
  applyRoadmap,
  enterStage,
  finishProject,
  isProjectFinished,
  setProgressStatus,
  setStep,
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
 * 模板规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec}
 */
const SPEC = loadSpec();

/**
 * 测试用的基准提交.
 * @type {string}
 */
const BASE_COMMIT = "a".repeat(40);

/**
 * 创建一份带一个里程与两个切片的状态.
 *
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 状态.
 */
function stateWithRoadmap() {
  const initial = createInitialState({ skillVersion: "1.0.0", now: NOW });
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
 * 在状态上新建一张工单.
 *
 * @param {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} state 状态.
 * @param {string} [kind] 工单类型.
 * @param {string} [slug] 短名.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 新状态.
 */
function draft(state, kind = "implementation", slug = "export-csv") {
  return createOrder(state, {
    kind,
    slug,
    slice: "0001",
    baseCommit: BASE_COMMIT,
  });
}

/**
 * 创建一份当前工单已发布的状态.
 *
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 状态.
 */
function stateWithIssuedOrder() {
  return setOrderStatus(draft(stateWithRoadmap()), "issued", {
    issuedDigest: "digest-1",
  });
}

test("工单: 新建后为起草状态, 文件夹名为编号加短名", () => {
  const state = draft(stateWithRoadmap());
  assert.equal(state.order.folder, "0001-export-csv");
  assert.equal(state.order.status, "drafting");
  assert.equal(state.order.round, 0);
});

test("工单: 严格串行, 未结束时不能新建", () => {
  assert.throws(
    () => draft(stateWithIssuedOrder(), "fix", "fix-csv"),
    WorkflowError,
  );
});

test("工单: 类型, 短名与切片编号必须合法", () => {
  const base = stateWithRoadmap();
  const options = {
    kind: "implementation",
    slug: "export-csv",
    slice: undefined,
    baseCommit: BASE_COMMIT,
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
    () => createOrder(base, { ...options, slice: "2" }),
    /现有切片 0001/u,
  );
});

test("工单: 不指定切片时挂在当前切片上", () => {
  const options = {
    kind: "fix",
    slug: "retry",
    slice: undefined,
    baseCommit: BASE_COMMIT,
  };
  const active = { ...stateWithRoadmap(), slice: "0001" };
  assert.equal(createOrder(active, options).order.slice, "0001");
  const idle = { ...stateWithRoadmap(), slice: null };
  assert.equal(createOrder(idle, options).order.slice, null);
});

test("工单: 每次发布轮次加一并记下工单内容的摘要", () => {
  const issued = stateWithIssuedOrder();
  assert.equal(issued.order.round, 1);
  assert.equal(issued.order.issuedDigest, "digest-1");
  const reissued = setOrderStatus(setOrderStatus(issued, "blocked"), "issued", {
    issuedDigest: "digest-2",
  });
  assert.equal(reissued.order.round, 2);
  assert.equal(reissued.order.issuedDigest, "digest-2");
});

test("工单: 已发布与受阻的工单可以撤回修改, 验收中的不能", () => {
  const issued = stateWithIssuedOrder();
  assert.equal(setOrderStatus(issued, "drafting").order.status, "drafting");
  assert.equal(
    setOrderStatus(setOrderStatus(issued, "blocked"), "drafting").order.status,
    "drafting",
  );
  assert.throws(
    () => setOrderStatus(setOrderStatus(issued, "reviewing"), "drafting"),
    WorkflowError,
  );
});

test("工单: 验收通过后移入历史, 记入切片的工单; 没有提交中的状态", () => {
  const accepted = setOrderStatus(
    setOrderStatus(stateWithIssuedOrder(), "reviewing"),
    "accepted",
  );
  assert.equal(accepted.order, null);
  assert.equal(accepted.orders.at(-1).status, "accepted");
  assert.deepEqual(
    accepted.slices.find((slice) => slice.id === "0001").orders,
    ["0001"],
  );
  assert.throws(
    () => setOrderStatus(stateWithIssuedOrder(), "committing"),
    WorkflowError,
  );
});

test("工单: 同一切片连续验收不通过的次数", () => {
  const reject = (state, slug) =>
    setOrderStatus(
      setOrderStatus(
        setOrderStatus(draft(state, "fix", slug), "issued"),
        "reviewing",
      ),
      "rejected",
    );
  const twice = reject(reject(stateWithRoadmap(), "first"), "second");
  assert.equal(consecutiveRejections(twice, "0001"), 2);
  assert.equal(consecutiveRejections(twice, "0002"), 0);
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

test("阶段: 只在最后一个阶段确认收尾, 完成标记只由确认收尾设置", () => {
  const state = stateWithRoadmap();
  assert.throws(() => finishProject(state, LAST_STAGE), WorkflowError);
  assert.throws(() => setStep(state, FINISHED_STEP), WorkflowError);
  const closing = enterStage(state, LAST_STAGE, LAST_STAGE);
  assert.ok(!isProjectFinished(closing, LAST_STAGE));
  const finished = finishProject(closing, LAST_STAGE);
  assert.ok(isProjectFinished(finished, LAST_STAGE));
  assert.ok(
    !isProjectFinished(enterStage(finished, 5, LAST_STAGE), LAST_STAGE),
    "继续迭代回到阶段 5 后不再是完成状态",
  );
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
  const decisions = addDecision(addDecision(withRisk, "选用 A"), "改用 B");
  const superseded = supersedeDecision(decisions, "0001", "0002");
  assert.equal(superseded.decisions[0].status, "superseded");
  const first = addCheckup(superseded);
  const second = addCheckup(first.state);
  assert.deepEqual([first.id, second.id], ["0001", "0002"]);
});

test("编排标记: 只认本项目的标记, 读不到转录时不算编排会话", () => {
  const root = "/项目 甲";
  const marker = orchestratorMarker(root);
  assert.match(marker, /^project-navigator 编排标记 [0-9a-f]{12}$/u);
  assert.ok(isOrchestratorTranscript(`前文\n${marker}\n后文`, root));
  assert.ok(
    !isOrchestratorTranscript(`${orchestratorMarker("/项目 乙")}`, root),
  );
  assert.ok(!isOrchestratorTranscript("project-navigator 编排标记", root));
  assert.ok(!isOrchestratorTranscript(undefined, root));
});

test("选项: 按规格中的选项文字识别用户的选择", () => {
  const optionSet = SPEC.replies["工单审阅"].optionSets[0];
  assert.ok(isChoiceSelected("A", optionSet, 0));
  assert.ok(isChoiceSelected("发布工单吧", optionSet, 0));
  assert.ok(!isChoiceSelected("B 判据 3 要改", optionSet, 0));
  assert.ok(isChoiceSelected("b", optionSet, 1));
  assert.ok(!isChoiceSelected("A", optionSet, 5), "不存在的选项不算选中");
});

test("验收结论: 按不通过与未验证分类, 自造的说法算未验证", () => {
  const review = (rows) =>
    [
      "# 验收记录",
      "",
      "## 判据核对",
      "",
      "| 判据 | 结论 | 证据 |",
      "| --- | --- | --- |",
      ...rows.map(
        ([criterion, verdict]) => `| ${criterion} | ${verdict} | 见日志 |`,
      ),
    ].join("\n");
  assert.deepEqual(
    classifyVerdicts(
      review([
        ["一", "通过"],
        ["二", "不通过"],
        ["三", "未验证"],
        ["四", "部分验证"],
      ]),
    ),
    { problem: undefined, failed: ["二"], unverified: ["三", "四"] },
  );
  assert.match(classifyVerdicts(undefined).problem ?? "", /还没有写入/u);
  assert.match(classifyVerdicts("# 验收记录\n").problem ?? "", /没有/u);
});

test("委派: 执行子代理的提示词写明手册, 工单与回执路径; 只产出记录的工单收窄范围", () => {
  const order = stateWithIssuedOrder().order;
  const brief = buildExecutorBrief({ projectRoot: "/项目", order });
  assert.match(brief, /^# 执行工单 0001/u);
  assert.match(brief, /project-navigator ref executor/u);
  assert.match(brief, /receipt\.md/u);
  assert.match(brief, /不提交, 不推送/u);
  const analysis = buildExecutorBrief({
    projectRoot: "/项目",
    order: { ...order, kind: "analysis" },
  });
  assert.match(analysis, /本工单只产出记录/u);
});

test("委派: 验收提示词写明代码检查, 不重跑外部影响的测试, MCP 只做只读调用", () => {
  const order = stateWithIssuedOrder().order;
  const brief = buildReviewBrief({
    projectRoot: "/项目",
    order,
    checkCommands: ["npm run lint"],
    criteriaTable: criteriaTableSpec(SPEC),
  });
  assert.match(brief, /- 代码检查: npm run lint/u);
  assert.match(brief, /"外部影响" 中列出的命令.+不运行/u);
  assert.match(brief, /只读调用/u);
  assert.match(brief, /从程序入口追到本工单的新代码/u);
  const runcheck = buildReviewBrief({
    projectRoot: "/项目",
    order: { ...order, kind: "runcheck" },
    checkCommands: [],
    criteriaTable: criteriaTableSpec(SPEC),
  });
  assert.match(runcheck, /- 代码检查: 无/u);
  assert.match(runcheck, /接线核查: 运行检查与分析工单只产出记录/u);
});

/**
 * 下一动作的公共输入.
 * @type {Omit<import("../../plugins/waypoint/skills/project-navigator/runtime/lib/guidance.mjs").GuidanceInput, "state">}
 */
const GUIDANCE_BASE = Object.freeze({
  receiptStatus: undefined,
  isEntry: false,
  spec: SPEC,
});

test("下一动作: 首次接入, 进入时恢复进度, 项目完成", () => {
  const fresh = createInitialState({ skillVersion: "1.0.0", now: NOW });
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: fresh }),
    /回复 "首次接入" \(reply entry\)/u,
  );
  assert.match(
    nextAction({
      ...GUIDANCE_BASE,
      state: stateWithIssuedOrder(),
      isEntry: true,
    }),
    /回复 "恢复进度" \(reply resume\)/u,
  );
  const finished = finishProject(
    enterStage(stateWithRoadmap(), LAST_STAGE, LAST_STAGE),
    LAST_STAGE,
  );
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: finished, isEntry: true }),
    /项目已完成, 没有待办: 回复 "项目完成"/u,
  );
  assert.match(
    nextAction({
      ...GUIDANCE_BASE,
      state: finished,
      hasUncommittedRecords: true,
    }),
    /记录还有未入库的改动: 调用 waypoint:commit-message/u,
  );
});

test("下一动作: 起草中的工单先审阅, 认可后发布并在后台派执行子代理", () => {
  const drafting = draft(stateWithRoadmap());
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: drafting }),
    /回复 "工单审阅" \(reply approve\); 用户选 A 后运行 order set issued, 再运行 exec-brief/u,
  );
  assert.match(
    nextAction({
      ...GUIDANCE_BASE,
      state: drafting,
      orderApproval: APPROVAL_STATUSES.awaiting,
    }),
    /等用户在 "工单审阅" 中选择/u,
  );
  assert.match(
    nextAction({
      ...GUIDANCE_BASE,
      state: drafting,
      orderApproval: APPROVAL_STATUSES.approved,
    }),
    /run_in_background\) 派 waypoint:navigator-executor, 然后回复 "工单执行"/u,
  );
});

test("下一动作: 已发布的工单按回执的执行状态处理", () => {
  const issued = stateWithIssuedOrder();
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: issued }),
    /由执行子代理处理中: 回复 "工单执行" \(reply running\)/u,
  );
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: issued, receiptStatus: "受阻" }),
    /order set blocked, 再回复 "受阻处理"/u,
  );
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: issued, receiptStatus: "完成" }),
    /order set reviewing, 再运行 review-brief/u,
  );
});

test("下一动作: 受阻的工单内容没改时直接继续, 改了要重新审阅", () => {
  const blocked = setOrderStatus(stateWithIssuedOrder(), "blocked");
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: blocked, isOrderUnchanged: true }),
    /用 SendMessage 让原执行子代理继续/u,
  );
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: blocked, isOrderUnchanged: false }),
    /必须重新审阅/u,
  );
  assert.match(
    nextAction({
      ...GUIDANCE_BASE,
      state: blocked,
      orderApproval: APPROVAL_STATUSES.approved,
    }),
    /修改已经用户审阅: 运行 order set issued/u,
  );
});

test("下一动作: 验收中按判据结论选组, 选型工单用第 4 组", () => {
  const reviewing = setOrderStatus(stateWithIssuedOrder(), "reviewing");
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: reviewing }),
    /全部通过用第 1 组, 有不通过用第 2 组, 只有未验证用第 3 组/u,
  );
  const selection = {
    ...reviewing,
    order: { ...reviewing.order, kind: "selection" },
  };
  assert.match(
    nextAction({ ...GUIDANCE_BASE, state: selection }),
    /使用第 4 组选项 \(reply review --option 4\), 由用户决定是否采用/u,
  );
});

test("状态结构: 新建的状态是当前结构, 没有旧字段", () => {
  const fresh = createInitialState({ skillVersion: "1.0.0", now: NOW });
  assert.equal(fresh.schema, STATE_SCHEMA_VERSION);
  for (const key of ["lastCommit", "stageCommit", "evidenceTools"]) {
    assert.ok(!(key in fresh), key);
  }
});
