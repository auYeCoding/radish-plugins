/**
 * @file waypoint 自迭代通用逻辑 (内置副本) 的单元测试. 断言与 tracepoint 的同名
 * 测试一致, 用来锁定两份副本行为相同.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  groupDefects,
  looksLikeCorrection,
  normalizeDefect,
  promotablePatterns,
} from "../../plugins/waypoint/runtime/lib/self-iteration.mjs";

/**
 * 造一条缺陷记录.
 *
 * @param {Partial<import("../../plugins/waypoint/runtime/lib/self-iteration.mjs").DefectRecord>} overrides 覆盖字段.
 * @returns {import("../../plugins/waypoint/runtime/lib/self-iteration.mjs").DefectRecord} 规整后的记录.
 */
function defect(overrides) {
  return normalizeDefect({
    plugin: "waypoint",
    skill: "commit-message",
    patternKey: "stale-scope",
    task: "t1",
    at: "2026-10-08T00:00:00Z",
    ...overrides,
  });
}

test("looksLikeCorrection 认出中英文纠正, 放过普通追问", () => {
  assert.equal(looksLikeCorrection("这里不对, 重来"), true);
  assert.equal(looksLikeCorrection("you got it wrong"), true);
  assert.equal(looksLikeCorrection("再帮我看下这个"), false);
  assert.equal(looksLikeCorrection("继续"), false);
  assert.equal(looksLikeCorrection(""), false);
});

test("normalizeDefect 容忍缺字段并全部补空串", () => {
  const record = normalizeDefect({ plugin: "waypoint" });
  assert.equal(record.plugin, "waypoint");
  assert.equal(record.rule, "");
  assert.equal(record.sawWhat, "");
  assert.equal(normalizeDefect(42).plugin, "");
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
    defect({ task: "t1" }),
    defect({ task: "t1" }),
    defect({ task: "t1" }),
  ]);
  assert.equal(promotablePatterns(oneTask, options).length, 0);

  const stale = groupDefects([
    defect({ task: "t1", at: "2026-01-01T00:00:00Z" }),
    defect({ task: "t2", at: "2026-01-02T00:00:00Z" }),
    defect({ task: "t2", at: "2026-01-02T00:00:00Z" }),
  ]);
  assert.equal(promotablePatterns(stale, options).length, 0);
});
