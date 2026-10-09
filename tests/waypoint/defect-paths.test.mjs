/**
 * @file waypoint 缺陷点目录定位的单元测试.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  DEFECT_DIR_NAME,
  findDefectDir,
} from "../../plugins/waypoint/runtime/lib/defect-paths.mjs";

/** @type {string} */
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "waypoint-defect-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test("findDefectDir 向上找到最近的 .waypoint 目录", () => {
  const defectDir = path.join(workDir, DEFECT_DIR_NAME);
  mkdirSync(defectDir, { recursive: true });
  const deep = path.join(workDir, "a", "b");
  mkdirSync(deep, { recursive: true });
  assert.equal(findDefectDir(deep), defectDir);
  assert.equal(findDefectDir(workDir), defectDir);
});

test("findDefectDir 没有点目录时返回 undefined", () => {
  const deep = path.join(workDir, "x", "y");
  mkdirSync(deep, { recursive: true });
  assert.equal(findDefectDir(deep), undefined);
});
