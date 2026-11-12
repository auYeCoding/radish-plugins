/**
 * @file 配置测试: 放行规则的合并与移除, 插件级 hook 与命令入口的接线.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  NAVIGATOR_PERMISSION_RULES,
  hasNavigatorPermissions,
  mergeNavigatorPermissions,
  removeNavigatorPermissions,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/settings.mjs";
import { SKILL_DIRECTORY } from "./helpers.mjs";

/**
 * 插件根目录.
 * @type {string}
 */
const PLUGIN_ROOT = path.resolve(SKILL_DIRECTORY, "..", "..");

/**
 * 用户自己的放行规则, 合并与移除都要保留.
 * @type {string}
 */
const USER_RULE = "Bash(npm test)";

test("配置: 合并放行规则保留用户规则, 重复合并不重复", () => {
  const merged = mergeNavigatorPermissions({
    permissions: { allow: [USER_RULE] },
  });
  assert.deepEqual(merged.permissions.allow, [
    USER_RULE,
    ...NAVIGATOR_PERMISSION_RULES,
  ]);
  assert.deepEqual(mergeNavigatorPermissions(merged), merged);
  assert.equal(hasNavigatorPermissions(merged), true);
  assert.equal(hasNavigatorPermissions({}), false);
});

test("配置: 移除放行规则只删本技能的规则, 空字段一并删除", () => {
  const merged = mergeNavigatorPermissions({
    permissions: { allow: [USER_RULE] },
  });
  assert.deepEqual(removeNavigatorPermissions(merged), {
    permissions: { allow: [USER_RULE] },
  });
  assert.deepEqual(
    removeNavigatorPermissions(mergeNavigatorPermissions({})),
    {},
  );
});

test("配置: 插件级 hook 接线三个事件, 都用不经过 shell 的写法指向 hook 入口", () => {
  const config = JSON.parse(
    readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"),
  );
  const events = ["PreToolUse", "UserPromptSubmit", "SessionStart"];
  assert.deepEqual(Object.keys(config.hooks).sort(), [...events].sort());
  for (const event of events) {
    const hook = config.hooks[event][0].hooks[0];
    assert.equal(hook.command, "node");
    assert.deepEqual(hook.args, [
      "${CLAUDE_PLUGIN_ROOT}/skills/project-navigator/runtime/hook.mjs",
    ]);
  }
  assert.match(config.hooks.PreToolUse[0].matcher, /Write/u);
});

test("配置: 插件 bin/ 中的两个命令入口都指向命令行脚本", () => {
  for (const name of ["project-navigator", "project-navigator.cmd"]) {
    const file = path.join(PLUGIN_ROOT, "bin", name);
    assert.ok(existsSync(file), name);
    assert.match(
      readFileSync(file, "utf8"),
      /skills.project-navigator.runtime.navigator\.mjs/u,
    );
  }
});
