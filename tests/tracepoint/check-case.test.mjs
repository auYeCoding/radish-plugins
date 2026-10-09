/**
 * @file 案卷校验器 check-case.mjs 的行为测试: 子进程跑脚本, 核对
 * 零项失败, 缺位置证据失败, 全部带证据才通过.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

/**
 * 校验器入口的绝对路径.
 * @type {string}
 */
const CHECK_PATH = fileURLToPath(
  new URL(
    "../../plugins/tracepoint/runtime/tools/check-case.mjs",
    import.meta.url,
  ),
);

/** @type {string} */
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "tracepoint-check-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * 写一个案卷并跑校验器, 返回退出码.
 *
 * @param {object} caseData 案卷内容.
 * @returns {number} 校验器退出码.
 */
function runCheck(caseData) {
  const caseDir = path.join(workDir, ".tracepoint");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    path.join(caseDir, "case.json"),
    JSON.stringify(caseData),
    "utf8",
  );
  const result = spawnSync(process.execPath, [CHECK_PATH, workDir], {
    encoding: "utf8",
  });
  return result.status;
}

test("零项结论必须失败, 不是通过", () => {
  assert.equal(runCheck({ findings: [] }), 1);
});

test("有结论但缺位置证据则失败", () => {
  assert.equal(
    runCheck({ findings: [{ text: "是 RC4", where: "", confidence: "" }] }),
    1,
  );
});

test("每条结论都带位置证据则通过", () => {
  assert.equal(
    runCheck({
      findings: [{ text: "是 RC4", where: "sub_401000", confidence: "high" }],
    }),
    0,
  );
});

test("没有案卷目录时失败", () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "tracepoint-empty-"));
  const result = spawnSync(process.execPath, [CHECK_PATH, empty], {
    encoding: "utf8",
  });
  rmSync(empty, { recursive: true, force: true });
  assert.equal(result.status, 1);
});
