/**
 * @file 规则文件测试: SKILL.md 的路由表与命令速查对得上实际的文件与命令, 工程规范
 * 的两种写法都能生成, 子代理定义与守卫中的名称一致.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  COMMAND_HANDLERS,
  ENTER_COMMAND,
} from "../../plugins/waypoint/skills/project-navigator/runtime/commands/handlers.mjs";
import { SUBAGENT_TYPES } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/guard.mjs";
import { renderEngineeringRules } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/project-settings.mjs";
import { ORGANIZATIONS } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { SKILL_DIRECTORY } from "./helpers.mjs";

/**
 * SKILL.md 的篇幅上限 (行).
 * @type {number}
 */
const SKILL_LINE_LIMIT = 150;

/**
 * 插件名与子代理名之间的分隔符.
 * @type {string}
 */
const PLUGIN_SEPARATOR = ":";

/**
 * 读取技能目录中的文件.
 *
 * @param {...string} segments 相对于技能目录的路径段.
 * @returns {string} 文件全文.
 */
function readSkillFile(...segments) {
  return readFileSync(path.join(SKILL_DIRECTORY, ...segments), "utf8");
}

test("规则: SKILL.md 篇幅受控, 路由表引用的参考文件都存在", () => {
  const skill = readSkillFile("SKILL.md");
  assert.ok(skill.split("\n").length <= SKILL_LINE_LIMIT);
  const routed = [...skill.matchAll(/\| `([a-z-]+)`\s+\|$/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(routed, ["intake", "slice-loop", "change"]);
  for (const name of routed) {
    assert.ok(
      existsSync(path.join(SKILL_DIRECTORY, "references", `${name}.md`)),
      name,
    );
  }
});

test("规则: 命令速查覆盖每条命令, 没有写不存在的命令", () => {
  const skill = readSkillFile("SKILL.md");
  const documented = new Set(
    [...skill.matchAll(/^\| `([^`]+)`(?:, `([^`]+)`)?/gmu)].flatMap((match) =>
      [match[1], match[2]]
        .filter((entry) => entry !== undefined)
        .map((entry) => entry.split(" ")[0]),
    ),
  );
  for (const name of ["intake", "slice-loop", "change"]) {
    documented.delete(name);
  }
  assert.deepEqual(
    [...documented].sort(),
    Object.keys(COMMAND_HANDLERS)
      .filter((command) => command !== ENTER_COMMAND)
      .sort(),
  );
});

test("规则: 工程规范的两种模块组织写法都能生成, 不留标记", () => {
  const standards = readSkillFile("standards", "engineering.md");
  const rendered = Object.values(ORGANIZATIONS).map((organization) =>
    renderEngineeringRules({ standards, organization, conventions: [] }),
  );
  for (const text of rendered) {
    assert.match(text, /^# 工程规范\n\n本文件由 project-navigator/u);
    assert.match(text, /## 模块组织\n\n- /u);
    assert.match(text, /单一数据源/u);
    assert.match(text, /不建通用模块/u);
    assert.doesNotMatch(text, /<!--|\n{3,}|## 项目约定/u);
  }
  assert.match(rendered[0], /物理目录/u);
  assert.doesNotMatch(rendered[0], /筛选器/u);
  assert.match(rendered[1], /\.vcxproj\.filters/u);
  assert.doesNotMatch(rendered[1], /一个模块一个目录/u);
});

test("规则: 子代理定义的名称与守卫中的一致, 验收子代理禁用写入工具", () => {
  for (const type of Object.values(SUBAGENT_TYPES)) {
    const name = type.split(PLUGIN_SEPARATOR)[1];
    const text = readFileSync(
      path.join(SKILL_DIRECTORY, "..", "..", "agents", `${name}.md`),
      "utf8",
    );
    assert.match(text, new RegExp(`^name: ${name}$`, "mu"));
  }
  assert.match(
    readFileSync(
      path.join(SKILL_DIRECTORY, "..", "..", "agents", "navigator-reviewer.md"),
      "utf8",
    ),
    /^disallowedTools: Write, Edit, MultiEdit, NotebookEdit$/mu,
  );
});
