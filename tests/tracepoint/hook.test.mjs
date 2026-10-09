/**
 * @file tracepoint 插件 hook 的共存与行为测试. 把 hook.mjs 当子进程跑, 用标准输入
 * 喂事件 JSON, 核对: 无案卷时完全静默, 子代理里静默, 有案卷时注入上下文并记录调用.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

/**
 * hook 入口的绝对路径.
 * @type {string}
 */
const HOOK_PATH = fileURLToPath(
  new URL("../../plugins/tracepoint/hooks/hook.mjs", import.meta.url),
);

/** @type {string} */
let workDir;

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "tracepoint-hook-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * 以给定事件跑一次 hook, 返回其标准输出.
 *
 * @param {Record<string, unknown>} event hook 事件 JSON.
 * @param {string} projectDir 作为 CLAUDE_PROJECT_DIR 的目录.
 * @returns {string} hook 的标准输出.
 */
function runHook(event, projectDir) {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/**
 * 在工作目录下建一个空案卷目录.
 *
 * @returns {string} 案卷目录路径.
 */
function makeCaseDir() {
  const caseDir = path.join(workDir, ".tracepoint");
  mkdirSync(caseDir, { recursive: true });
  return caseDir;
}

test("共存: 没有 .tracepoint 时 hook 完全静默", () => {
  const out = runHook(
    { hook_event_name: "SessionStart", source: "startup" },
    workDir,
  );
  assert.equal(out, "");
});

test("共存: 子代理 (带 agent_id) 里不注入", () => {
  makeCaseDir();
  const out = runHook(
    { hook_event_name: "SessionStart", source: "startup", agent_id: "sub-1" },
    workDir,
  );
  assert.equal(out, "");
});

test("SessionStart 在有案卷时注入案卷摘要", () => {
  makeCaseDir();
  const out = runHook(
    { hook_event_name: "SessionStart", source: "startup" },
    workDir,
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(
    parsed.hookSpecificOutput.additionalContext,
    /逆向案卷|先读它再动手/u,
  );
});

test("UserPromptSubmit 在被纠正时追加缺陷记录提示", () => {
  makeCaseDir();
  const plain = runHook(
    { hook_event_name: "UserPromptSubmit", prompt: "继续分析" },
    workDir,
  );
  assert.doesNotMatch(
    JSON.parse(plain).hookSpecificOutput.additionalContext,
    /defects/u,
  );
  const corrected = runHook(
    { hook_event_name: "UserPromptSubmit", prompt: "不对, 重来" },
    workDir,
  );
  assert.match(
    JSON.parse(corrected).hookSpecificOutput.additionalContext,
    /defects/u,
  );
});

test("PostToolUse 记录 MCP 调用到案卷且不产生输出", () => {
  const caseDir = makeCaseDir();
  const out = runHook(
    {
      hook_event_name: "PostToolUse",
      tool_name: "mcp__plugin_ida-pro-mcp_idalib__decompile",
      tool_input: { function: "sub_401000" },
    },
    workDir,
  );
  assert.equal(out, "");
  const data = JSON.parse(
    readFileSync(path.join(caseDir, "case.json"), "utf8"),
  );
  assert.equal(data.toolCalls.length, 1);
  assert.equal(data.toolCalls[0].target, "sub_401000");
});
