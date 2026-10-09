/**
 * @file tracepoint 技能自迭代通用逻辑的单元测试.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeDefect,
  describeGroup,
  groupDefects,
  looksLikeCorrection,
  normalizeDefect,
  promotablePatterns,
} from "../../plugins/tracepoint/runtime/lib/self-iteration.mjs";

/**
 * 造一条缺陷记录.
 *
 * @param {Partial<import("../../plugins/tracepoint/runtime/lib/self-iteration.mjs").DefectRecord>} overrides 覆盖字段.
 * @returns {import("../../plugins/tracepoint/runtime/lib/self-iteration.mjs").DefectRecord} 规整后的记录.
 */
function defect(overrides) {
  return normalizeDefect({
    plugin: "tracepoint",
    skill: "analyze",
    patternKey: "repeat-analysis",
    task: "t1",
    at: "2026-10-08T00:00:00Z",
    ...overrides,
  });
}

test("looksLikeCorrection 认出中英文纠正, 放过普通追问", () => {
  assert.equal(looksLikeCorrection("这里不对, 重来"), true);
  assert.equal(looksLikeCorrection("you got it wrong"), true);
  assert.equal(looksLikeCorrection("再帮我看下这个函数"), false);
  assert.equal(looksLikeCorrection("继续"), false);
  assert.equal(looksLikeCorrection(""), false);
});

test("normalizeDefect 容忍缺字段并全部补空串", () => {
  const record = normalizeDefect({ plugin: "tracepoint" });
  assert.equal(record.plugin, "tracepoint");
  assert.equal(record.rule, "");
  assert.equal(record.sawWhat, "");
  const junk = normalizeDefect(42);
  assert.equal(junk.plugin, "");
});

test("groupDefects 按模式键去重计数且按条数降序", () => {
  const groups = groupDefects([
    defect({ patternKey: "a", task: "t1" }),
    defect({ patternKey: "a", task: "t2" }),
    defect({ patternKey: "a", task: "t2" }),
    defect({ patternKey: "b", task: "t1" }),
  ]);
  assert.equal(groups[0].patternKey, "a");
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].tasks.sort(), ["t1", "t2"]);
  assert.equal(groups[1].patternKey, "b");
});

test("promotablePatterns 要求复现, 跨任务与时效都达标", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const options = { minCount: 3, minTasks: 2, withinDays: 30, now };
  const enough = groupDefects([
    defect({ task: "t1", at: "2026-10-18T00:00:00Z" }),
    defect({ task: "t2", at: "2026-10-19T00:00:00Z" }),
    defect({ task: "t2", at: "2026-10-19T00:00:00Z" }),
  ]);
  assert.equal(promotablePatterns(enough, options).length, 1);

  const oneTask = groupDefects([
    defect({ task: "t1", at: "2026-10-18T00:00:00Z" }),
    defect({ task: "t1", at: "2026-10-18T00:00:00Z" }),
    defect({ task: "t1", at: "2026-10-18T00:00:00Z" }),
  ]);
  assert.equal(promotablePatterns(oneTask, options).length, 0);

  const stale = groupDefects([
    defect({ task: "t1", at: "2026-01-01T00:00:00Z" }),
    defect({ task: "t2", at: "2026-01-02T00:00:00Z" }),
    defect({ task: "t2", at: "2026-01-02T00:00:00Z" }),
  ]);
  assert.equal(promotablePatterns(stale, options).length, 0);
});

test("describeDefect 首行是时间, 技能与任务, 其后只列填了的事实", () => {
  const lines = describeDefect(
    defect({ sawWhat: "函数已在案卷里", didWhat: "又反编译了一遍" }),
  );
  assert.deepEqual(lines, [
    "2026-10-08T00:00:00Z | analyze | t1",
    "看到: 函数已在案卷里",
    "做了: 又反编译了一遍",
  ]);
});

test("describeDefect 对空记录给出占位说明", () => {
  assert.deepEqual(describeDefect(normalizeDefect({})), [
    "(未注明时间, 技能与任务)",
    "(这条记录没有写任何事实)",
  ]);
});

test("describeGroup 在统计行之后逐条列出带序号的记录", () => {
  const [group] = groupDefects([
    defect({ task: "t1", sawWhat: "函数已在案卷里" }),
    defect({ task: "t2", rule: "动手前先查案卷" }),
  ]);
  assert.deepEqual(describeGroup(group), [
    "- repeat-analysis: 2 条, 跨 2 个任务, 涉及技能 analyze",
    "  1. 2026-10-08T00:00:00Z | analyze | t1",
    "     看到: 函数已在案卷里",
    "  2. 2026-10-08T00:00:00Z | analyze | t2",
    "     依据: 动手前先查案卷",
  ]);
});
