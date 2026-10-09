/**
 * @file waypoint 插件级 hook 的门控与共存测试. 把 hook.mjs 当子进程跑, 用标准输入
 * 喂事件 JSON, 核对: 只有 "本会话用过 commit-message/repo-init 且被纠正" 才注入;
 * project-navigator 不记信号 (编排会话不被触发); 子代理静默.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * hook 入口的绝对路径.
 * @type {string}
 */
const HOOK_PATH = fileURLToPath(
  new URL("../../plugins/waypoint/hooks/hook.mjs", import.meta.url),
);

/**
 * 以给定事件跑一次 hook, 返回其标准输出.
 *
 * @param {Record<string, unknown>} event hook 事件 JSON.
 * @returns {string} hook 的标准输出.
 */
function runHook(event) {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("用过 commit-message 且被纠正时注入缺陷提示", () => {
  const sessionId = randomUUID();
  const post = runHook({
    hook_event_name: "PostToolUse",
    tool_name: "Skill",
    tool_input: { skill: "waypoint:commit-message" },
    session_id: sessionId,
  });
  assert.equal(post, "");
  const corrected = runHook({
    hook_event_name: "UserPromptSubmit",
    prompt: "不对, 重来",
    session_id: sessionId,
  });
  assert.match(
    JSON.parse(corrected).hookSpecificOutput.additionalContext,
    /defects/u,
  );
});

test("没有信号时即使被纠正也静默", () => {
  const out = runHook({
    hook_event_name: "UserPromptSubmit",
    prompt: "不对",
    session_id: randomUUID(),
  });
  assert.equal(out, "");
});

test("用过 commit-message 但消息不像纠正时静默", () => {
  const sessionId = randomUUID();
  runHook({
    hook_event_name: "PostToolUse",
    tool_name: "Skill",
    tool_input: { skill: "waypoint:commit-message" },
    session_id: sessionId,
  });
  const out = runHook({
    hook_event_name: "UserPromptSubmit",
    prompt: "继续写文档",
    session_id: sessionId,
  });
  assert.equal(out, "");
});

test("project-navigator 不记信号, 编排会话不被触发", () => {
  const sessionId = randomUUID();
  runHook({
    hook_event_name: "PostToolUse",
    tool_name: "Skill",
    tool_input: { skill: "waypoint:project-navigator" },
    session_id: sessionId,
  });
  const out = runHook({
    hook_event_name: "UserPromptSubmit",
    prompt: "不对, 重来",
    session_id: sessionId,
  });
  assert.equal(out, "");
});

test("子代理 (带 agent_id) 里不动作", () => {
  const sessionId = randomUUID();
  runHook({
    hook_event_name: "PostToolUse",
    tool_name: "Skill",
    tool_input: { skill: "waypoint:commit-message" },
    session_id: sessionId,
    agent_id: "sub-1",
  });
  const out = runHook({
    hook_event_name: "UserPromptSubmit",
    prompt: "不对, 重来",
    session_id: sessionId,
    agent_id: "sub-1",
  });
  assert.equal(out, "");
});
