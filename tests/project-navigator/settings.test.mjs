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
import { findSettingsEditProblem } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/settings-edits.mjs";

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

/**
 * 把配置对象写成配置文件的全文.
 *
 * @param {Record<string, any>} settings 配置对象.
 * @returns {string} 文件全文.
 */
function text(settings) {
  return `${JSON.stringify(settings, null, 2)}\n`;
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

test("配置改动: 只在 hooks 字段中增删项目的 hook 时没有问题", () => {
  const installed = mergeAll(USER_SETTINGS);
  const added = {
    ...installed,
    hooks: {
      ...installed.hooks,
      Notification: [{ hooks: [{ type: "command", command: "notify" }] }],
    },
  };
  assert.equal(
    findSettingsEditProblem(text(installed), text(added)),
    undefined,
  );
  assert.equal(
    findSettingsEditProblem(text(added), text(installed)),
    undefined,
  );
  const removed = {
    ...installed,
    hooks: {
      ...installed.hooks,
      PostToolUse: installed.hooks.PostToolUse.slice(1),
    },
  };
  assert.equal(
    findSettingsEditProblem(text(installed), text(removed)),
    undefined,
    "可以调整项目自己的 hook",
  );
});

test("配置改动: 字段顺序与排版变化不算改动", () => {
  const installed = mergeAll(USER_SETTINGS);
  const reordered = Object.fromEntries(Object.entries(installed).reverse());
  assert.equal(
    findSettingsEditProblem(text(installed), JSON.stringify(reordered)),
    undefined,
  );
});

test("配置改动: 动了本技能的分组或 hooks 之外的字段时指出问题", () => {
  const installed = mergeAll(USER_SETTINGS);
  const before = text(installed);
  const problemOf = (next) => findSettingsEditProblem(before, text(next));
  assert.match(
    problemOf(removeNavigatorHooks(installed)) ?? "",
    /本技能的 hook 分组/u,
  );
  assert.match(
    problemOf({
      ...installed,
      hooks: {
        ...installed.hooks,
        Stop: installed.hooks.Stop.map((group) => ({ ...group, matcher: "x" })),
      },
    }) ?? "",
    /本技能的 hook 分组/u,
    "给本技能的分组加匹配器也算改动",
  );
  assert.match(
    problemOf({ ...installed, model: "haiku", env: { A: "1" } }) ?? "",
    /hooks 之外的字段: env, model/u,
  );
  assert.match(
    problemOf(removeNavigatorPermissions(installed)) ?? "",
    /hooks 之外的字段: permissions/u,
  );
});

test("配置改动: 内容缺失, 无法重建或结构不对时指出问题", () => {
  const before = text(mergeAll({}));
  assert.match(
    findSettingsEditProblem(undefined, before) ?? "",
    /运行 init 修复/u,
  );
  assert.match(findSettingsEditProblem("{", before) ?? "", /运行 init 修复/u);
  assert.match(
    findSettingsEditProblem(before, undefined) ?? "",
    /无法确定写入后的内容/u,
  );
  for (const broken of [
    "{",
    "[]",
    '{"hooks": []}',
    '{"hooks": {"Stop": {}}}',
  ]) {
    assert.match(
      findSettingsEditProblem(before, broken) ?? "",
      /不是合法的 JSON 配置/u,
      broken,
    );
  }
  assert.match(
    findSettingsEditProblem(
      before,
      '{"hooks": {"Stop": [{"hooks": "node"}, null]}}',
    ) ?? "",
    /不是合法的 JSON 配置/u,
  );
});
