/**
 * @file 配置测试: 放行规则的合并与移除, 旧版本项目级 hook 的清理, 插件级 hook 与
 * 命令入口的接线.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  LEGACY_COMMAND_PATH,
  LEGACY_HOOK_ENTRY_ARGUMENT,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/paths.mjs";
import {
  NAVIGATOR_PERMISSION_RULES,
  hasLegacyHooks,
  mergeNavigatorPermissions,
  removeLegacyHooks,
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

/**
 * 1.0.0 之前写入的项目级 hook 分组.
 * @type {Record<string, any>}
 */
const LEGACY_GROUP = Object.freeze({
  matcher: "*",
  hooks: [
    { type: "command", command: "node", args: [LEGACY_HOOK_ENTRY_ARGUMENT] },
  ],
});

/**
 * 用户自己的 hook 分组.
 * @type {Record<string, any>}
 */
const USER_GROUP = Object.freeze({
  matcher: "Write",
  hooks: [{ type: "command", command: "npx prettier --write" }],
});

test("配置: 合并放行规则保留用户规则, 去掉旧版本规则, 重复合并不重复", () => {
  const legacy = `Bash(node ${LEGACY_COMMAND_PATH} *)`;
  const merged = mergeNavigatorPermissions({
    permissions: { allow: [USER_RULE, legacy] },
  });
  assert.deepEqual(merged.permissions.allow, [
    USER_RULE,
    ...NAVIGATOR_PERMISSION_RULES,
  ]);
  assert.deepEqual(mergeNavigatorPermissions(merged), merged);
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

test("配置: 识别并移除旧版本的项目级 hook, 用户的 hook 保留", () => {
  const settings = {
    hooks: { PreToolUse: [LEGACY_GROUP, USER_GROUP], Stop: [LEGACY_GROUP] },
  };
  assert.equal(hasLegacyHooks(settings), true);
  const cleaned = removeLegacyHooks(settings);
  assert.deepEqual(cleaned, { hooks: { PreToolUse: [USER_GROUP] } });
  assert.equal(hasLegacyHooks(cleaned), false);
  assert.deepEqual(removeLegacyHooks({ hooks: { Stop: [LEGACY_GROUP] } }), {});
});

test("配置: 插件级 hook 接线四个事件, 都用不经过 shell 的写法指向 hook 入口", () => {
  const config = JSON.parse(
    readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"),
  );
  const events = ["PreToolUse", "UserPromptSubmit", "SessionStart", "Stop"];
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
