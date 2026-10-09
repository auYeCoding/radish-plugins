/**
 * @file tracepoint 案卷读写与路径定位的单元测试.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  appendToolCall,
  readCase,
  renderCaseAnchor,
  renderCaseSummary,
  writeCase,
} from "../../plugins/tracepoint/runtime/lib/case-file.mjs";
import {
  CASE_DIR_NAME,
  findCaseDir,
} from "../../plugins/tracepoint/runtime/lib/paths.mjs";

/** @type {string} */
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "tracepoint-case-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * 在工作目录下建一个案卷目录.
 *
 * @param {string} baseDir 基准目录.
 * @returns {string} 案卷目录路径.
 */
function makeCaseDir(baseDir) {
  const caseDir = path.join(baseDir, CASE_DIR_NAME);
  mkdirSync(caseDir, { recursive: true });
  return caseDir;
}

test("findCaseDir 向上找到最近的案卷目录", () => {
  const caseDir = makeCaseDir(workDir);
  const deep = path.join(workDir, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  assert.equal(findCaseDir(deep), caseDir);
  assert.equal(findCaseDir(workDir), caseDir);
});

test("findCaseDir 没有案卷时返回 undefined", () => {
  const deep = path.join(workDir, "x", "y");
  mkdirSync(deep, { recursive: true });
  assert.equal(findCaseDir(deep), undefined);
});

test("readCase 对缺失或损坏的文件返回空案卷", () => {
  const caseDir = makeCaseDir(workDir);
  const empty = readCase(caseDir);
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.target, "");
  writeFileSync(path.join(caseDir, "case.json"), "{ not json", "utf8");
  assert.deepEqual(readCase(caseDir).findings, []);
});

test("writeCase 与 readCase 往返保留结构化结论", () => {
  const caseDir = makeCaseDir(workDir);
  writeCase(caseDir, {
    schemaVersion: 1,
    target: "t",
    protection: "VM",
    findings: [{ text: "是 XTEA 变体", where: "sub_1000", confidence: "high" }],
    todo: ["看 crc"],
    tried: ["angr"],
    toolCalls: [],
    updatedAt: "2026-10-09T00:00:00Z",
  });
  const back = readCase(caseDir);
  assert.equal(back.protection, "VM");
  assert.equal(back.findings.length, 1);
  assert.equal(back.findings[0].where, "sub_1000");
  assert.deepEqual(back.tried, ["angr"]);
});

test("normalize 容忍把旧式字符串结论与杂乱字段", () => {
  const caseDir = makeCaseDir(workDir);
  writeFileSync(
    path.join(caseDir, "case.json"),
    JSON.stringify({
      findings: ["旧式字符串", { text: "x", where: "w" }],
      todo: "不是数组",
    }),
    "utf8",
  );
  const data = readCase(caseDir);
  assert.equal(data.findings.length, 2);
  assert.equal(data.findings[0].text, "旧式字符串");
  assert.equal(data.findings[0].where, "");
  assert.deepEqual(data.todo, []);
});

test("appendToolCall 记录调用并封顶", () => {
  const caseDir = makeCaseDir(workDir);
  for (let index = 0; index < 250; index += 1) {
    appendToolCall(caseDir, {
      name: "mcp__x",
      target: `f${index}`,
      at: "2026-10-09T00:00:00Z",
    });
  }
  const data = readCase(caseDir);
  assert.equal(data.toolCalls.length, 200);
  assert.equal(data.toolCalls.at(-1).target, "f249");
});

test("renderCaseSummary 与 renderCaseAnchor 给出可注入文字", () => {
  const data = readCase(makeCaseDir(workDir));
  const summary = renderCaseSummary(data);
  assert.match(summary, /先读它再动手/u);
  const anchor = renderCaseAnchor(data);
  assert.match(anchor, /逆向案卷在用/u);
});
