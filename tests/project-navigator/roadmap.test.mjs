/**
 * @file 路线与切片状态转换的单元测试: 草稿合并, 骨架, 同一时间一个切片, 里程完成,
 * 下一动作与进展.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nextAction,
  progressLine,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/guidance.mjs";
import {
  applyRoadmap,
  completeMilestone,
  currentMilestone,
  findSlice,
  finishProject,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/roadmap.mjs";
import {
  acceptSlice,
  dropSlice,
  planSlice,
  redoSlice,
  refreshPlan,
  reviewSlice,
  startSlice,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/slice-flow.mjs";
import { VERDICT_CLASSES } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/slice-file.mjs";
import { createInitialState } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { WorkflowError } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-error.mjs";

/**
 * 测试中的路线草稿: 两个里程, 第二个还没有排切片.
 * @type {Readonly<Record<string, unknown>>}
 */
const DRAFT = Object.freeze({
  milestones: [
    {
      name: "甲",
      goal: "跑通",
      slices: [{ name: "骨架" }, { name: "查清", kind: "findings" }],
    },
    { name: "乙", goal: "丰满" },
  ],
});

/**
 * 没有进行中的切片时的事实.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/guidance.mjs").ProgressFacts}
 */
const NO_FACTS = Object.freeze({
  hasRequirements: true,
  resultStatus: "",
  verdictCount: 0,
  verdictProblems: [],
  verdictClass: VERDICT_CLASSES.pass,
});

/**
 * 生成已登记项目设置的初始状态.
 *
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 状态.
 */
function readyState() {
  return {
    ...createInitialState({ skillVersion: "2.0.0", now: "2026-11-12" }),
    project: {
      organization: "directories",
      verification: { mode: "manual", commands: [] },
      conventions: [],
    },
  };
}

/**
 * 把骨架切片从写计划走到通过.
 *
 * @param {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} state 状态.
 * @param {string} id 切片编号.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs").NavigatorState} 新状态.
 */
function finishSlice(state, id) {
  const started = startSlice(planSlice(state, id, `slices/${id}.md`), {
    baseCommit: "abc",
    planDigest: "d1",
  });
  return acceptSlice(reviewSlice(started));
}

test("路线: 没有登记项目设置时不能排路线", () => {
  const state = createInitialState({ skillVersion: "2.0.0", now: "now" });
  assert.throws(() => applyRoadmap(state, DRAFT), /请先运行 setup/u);
  assert.throws(() => applyRoadmap(readyState(), {}), WorkflowError);
});

test("路线: 分配编号, 标出骨架与当前里程, 只产出结论的切片默认交互式", () => {
  const state = applyRoadmap(readyState(), DRAFT);
  assert.equal(state.stage, "slicing");
  assert.deepEqual(
    state.milestones.map((milestone) => [milestone.id, milestone.status]),
    [
      ["0001", "active"],
      ["0002", "pending"],
    ],
  );
  const [skeleton, findings] = state.milestones[0].slices;
  assert.deepEqual(
    [skeleton.id, skeleton.skeleton, skeleton.kind, skeleton.interactive],
    ["0001", true, "build", false],
  );
  assert.deepEqual(
    [findings.id, findings.skeleton, findings.interactive],
    ["0002", false, true],
  );
  assert.deepEqual(state.next, { milestone: 3, slice: 3, decision: 1 });
  assert.equal(progressLine(state), "里程 0001 甲 (0/2)");
});

test("路线: 更新时已经开始的切片原样保留, 不能丢掉; 没开始的可以改", () => {
  const started = planSlice(
    applyRoadmap(readyState(), DRAFT),
    "0001",
    "slices/0001.md",
  );
  const keep = { id: "0001", name: "改了名字也不生效" };
  const updated = applyRoadmap(started, {
    milestones: [
      {
        id: "0001",
        name: "甲改",
        goal: "跑通",
        slices: [keep, { id: "0002", name: "查清楚" }, { name: "新切片" }],
      },
    ],
  });
  const [first, second, third] = updated.milestones[0].slices;
  assert.deepEqual([first.name, first.status], ["骨架", "planned"]);
  assert.deepEqual([second.name, second.kind], ["查清楚", "build"]);
  assert.equal(third.id, "0003");
  assert.equal(updated.milestones[0].name, "甲改");
  assert.throws(
    () =>
      applyRoadmap(started, {
        milestones: [{ id: "0001", name: "甲", goal: "乙", slices: [] }],
      }),
    /缺少已经开始的切片 0001/u,
  );
  assert.throws(
    () => applyRoadmap(started, { milestones: [{ id: "0009", name: "x" }] }),
    /里程 0009 不存在/u,
  );
});

test("切片: 同一时间只做一个, 骨架通过之前不做别的, 状态按顺序流转", () => {
  const base = applyRoadmap(readyState(), DRAFT);
  assert.throws(() => planSlice(base, "0002", "f.md"), /最小骨架/u);
  assert.throws(() => planSlice(base, "0009", "f.md"), /0001, 0002/u);
  assert.throws(() => startSlice(base, {}), /没有进行中的切片/u);
  const planned = planSlice(base, "0001", "slices/0001.md");
  assert.deepEqual(planned.current, {
    sliceId: "0001",
    baseCommit: null,
    planDigest: null,
    round: 1,
  });
  assert.throws(() => planSlice(planned, "0002", "f.md"), /还在进行/u);
  assert.throws(() => reviewSlice(planned), /要求它是 "实现中"/u);
  assert.throws(() => dropSlice(planned), /最小骨架, 不能放弃/u);
  const running = startSlice(planned, { baseCommit: "abc", planDigest: "d1" });
  assert.equal(refreshPlan(running, "d2").current?.planDigest, "d2");
  const reviewing = reviewSlice(running);
  const redone = redoSlice(reviewing, "d3");
  assert.deepEqual(
    [redone.current?.round, redone.current?.planDigest],
    [2, "d3"],
  );
  assert.equal(findSlice(redone, "0001")?.slice.status, "running");
  const accepted = acceptSlice(reviewing);
  assert.equal(accepted.current, null);
  assert.equal(findSlice(accepted, "0001")?.slice.status, "done");
  const dropped = dropSlice(planSlice(accepted, "0002", "slices/0002.md"));
  assert.equal(findSlice(dropped, "0002")?.slice.status, "dropped");
});

test("路线: 里程的切片都结束后才能完成, 全部里程完成后才能收尾", () => {
  const base = applyRoadmap(readyState(), {
    milestones: [{ name: "甲", goal: "乙", slices: [{ name: "骨架" }] }],
  });
  assert.throws(() => completeMilestone(base, "0001"), /还有没结束的切片/u);
  assert.throws(() => finishProject(base), /还没有完成/u);
  const done = completeMilestone(finishSlice(base, "0001"), "0001");
  assert.equal(currentMilestone(done), undefined);
  assert.match(nextAction(done, NO_FACTS), /finish/u);
  assert.throws(
    () =>
      applyRoadmap(done, {
        milestones: [
          {
            id: "0001",
            name: "甲",
            goal: "乙",
            slices: [{ id: "0001", name: "骨架" }, { name: "新" }],
          },
        ],
      }),
    /已经完成, 不能再加切片/u,
  );
  const finished = finishProject(done);
  assert.equal(finished.stage, "finished");
  assert.match(nextAction(finished, NO_FACTS), /已确认收尾/u);
  const reopened = applyRoadmap(finished, {
    milestones: [
      {
        id: "0001",
        name: "甲",
        goal: "乙",
        slices: [{ id: "0001", name: "骨架" }],
      },
      { name: "丙", goal: "新目标", slices: [{ name: "新功能" }] },
    ],
  });
  assert.equal(reopened.stage, "slicing");
  assert.equal(currentMilestone(reopened)?.id, "0002");
});

test("下一动作: 立项阶段依次要求需求, 项目设置, 路线", () => {
  const blank = createInitialState({ skillVersion: "2.0.0", now: "now" });
  assert.match(
    nextAction(blank, { ...NO_FACTS, hasRequirements: false }),
    /requirements\.md/u,
  );
  assert.match(nextAction(blank, NO_FACTS), /登记项目设置/u);
  assert.match(nextAction(readyState(), NO_FACTS), /写路线/u);
  assert.equal(progressLine(blank), "阶段 立项");
});
