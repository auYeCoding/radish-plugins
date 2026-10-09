/**
 * @file waypoint 的 review-defects.mjs 的端到端行为测试: 子进程跑脚本, 核对它读
 * `.waypoint/defects/` 的 JSON, 没有点目录与空目录的处理, 逐条列出记录的事实,
 * 以及达阈值模式的呈现.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

/**
 * 脚本入口的绝对路径.
 * @type {string}
 */
const SCRIPT = fileURLToPath(
  new URL(
    "../../plugins/waypoint/runtime/tools/review-defects.mjs",
    import.meta.url,
  ),
);

/** @type {string} */
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "waypoint-review-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * 在工作目录建缺陷收件目录.
 *
 * @returns {string} defects 目录路径.
 */
function makeDefectsDir() {
  const dir = path.join(workDir, ".waypoint", "defects");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 跑脚本, 返回标准输出.
 *
 * @returns {string} 标准输出.
 */
function runReview() {
  const result = spawnSync(process.execPath, [SCRIPT, workDir], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("没有点目录时提示无缺陷", () => {
  assert.match(runReview(), /没有找到 \.waypoint\//u);
});

test("收件目录为空时如实说明", () => {
  makeDefectsDir();
  assert.match(runReview(), /收件目录为空/u);
});

test("未达阈值的记录也逐条列出事实供核实", () => {
  const dir = makeDefectsDir();
  writeFileSync(
    path.join(dir, "only.json"),
    JSON.stringify({
      plugin: "waypoint",
      skill: "commit-message",
      rule: "scope 沿用仓库历史",
      patternKey: "stale-scope",
      sawWhat: "改动只涉及文档",
      didWhat: "scope 写成了 parser",
      result: "用户改成了 docs",
      task: "t1",
      at: "2026-10-08T00:00:00Z",
    }),
    "utf8",
  );
  const out = runReview();
  assert.match(out, /共 1 条缺陷记录/u);
  assert.match(out, /1\. 2026-10-08T00:00:00Z \| commit-message \| t1/u);
  assert.match(out, /看到: 改动只涉及文档/u);
  assert.match(out, /依据: scope 沿用仓库历史/u);
  assert.match(out, /做了: scope 写成了 parser/u);
  assert.match(out, /结果: 用户改成了 docs/u);
  assert.match(out, /未达阈值不提请改技能/u);
});

test("达阈值的模式被列出, 损坏文件被跳过", () => {
  const dir = makeDefectsDir();
  const now = new Date().toISOString();
  for (let index = 0; index < 3; index += 1) {
    writeFileSync(
      path.join(dir, `d${index}.json`),
      JSON.stringify({
        plugin: "waypoint",
        skill: "commit-message",
        patternKey: "stale-scope",
        task: index === 0 ? "t1" : "t2",
        at: now,
      }),
      "utf8",
    );
  }
  writeFileSync(path.join(dir, "broken.json"), "{ not json", "utf8");
  const out = runReview();
  assert.match(out, /共 3 条缺陷记录/u);
  assert.match(out, /stale-scope: 3 条, 跨 2 个任务/u);
  assert.match(out, /值得提请用户看/u);
});
