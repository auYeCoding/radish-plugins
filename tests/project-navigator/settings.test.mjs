/**
 * @file 配置合并与移除的测试: hook 条目与放行规则.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NAVIGATOR_PERMISSION_RULES,
  hasAllNavigatorHooks,
  mergeNavigatorHooks,
  mergeNavigatorPermissions,
  removeNavigatorHooks,
  removeNavigatorPermissions,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/settings.mjs";

/**
 * 用户已有的配置, 含一个自己的 hook, 一条放行规则与其它设置.
 * @type {Record<string, any>}
 */
const USER_SETTINGS = Object.freeze({
  model: "opus",
  permissions: { allow: ["Bash(npm test)"], deny: ["Bash(rm *)"] },
  hooks: {
    PostToolUse: [
      {
        matcher: "Write",
        hooks: [{ type: "command", command: "prettier --write" }],
      },
    ],
  },
});

/**
 * 同时合并 hook 与放行规则.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
function mergeAll(settings) {
  return mergeNavigatorPermissions(mergeNavigatorHooks(settings));
}

/**
 * 同时移除 hook 与放行规则.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
function removeAll(settings) {
  return removeNavigatorPermissions(removeNavigatorHooks(settings));
}

test("配置: 合并后安装全部事件与放行规则, 且保留用户已有配置", () => {
  const merged = mergeAll(USER_SETTINGS);
  assert.ok(hasAllNavigatorHooks(merged));
  assert.equal(merged.model, "opus");
  assert.deepEqual(merged.permissions.deny, USER_SETTINGS.permissions.deny);
  assert.ok(merged.permissions.allow.includes("Bash(npm test)"));
  for (const rule of NAVIGATOR_PERMISSION_RULES) {
    assert.ok(merged.permissions.allow.includes(rule), `缺少放行规则 ${rule}`);
  }
  assert.deepEqual(
    merged.hooks.PostToolUse[0],
    USER_SETTINGS.hooks.PostToolUse[0],
  );
});

test("配置: 重复合并不产生重复条目", () => {
  const once = mergeAll(USER_SETTINGS);
  assert.deepEqual(mergeAll(once), once);
});

test("配置: 移除只删除本技能的条目, 恢复用户原配置", () => {
  assert.deepEqual(removeAll(mergeAll(USER_SETTINGS)), USER_SETTINGS);
});

test("配置: 空配置合并后再移除, 不留下空字段", () => {
  assert.deepEqual(removeAll(mergeAll({})), {});
  assert.ok(!hasAllNavigatorHooks({}));
});

test("配置: 只合并放行规则时不写入 hook", () => {
  const local = mergeNavigatorPermissions({});
  assert.equal(local.hooks, undefined);
  assert.deepEqual(local.permissions.allow, [...NAVIGATOR_PERMISSION_RULES]);
});

test("配置: 合并不修改传入的对象", () => {
  const input = structuredClone(USER_SETTINGS);
  mergeAll(input);
  assert.deepEqual(input, USER_SETTINGS);
});
