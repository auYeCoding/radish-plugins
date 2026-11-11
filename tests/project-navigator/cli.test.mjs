/**
 * @file 命令行测试: 进入, 初始化, 忽略规则检查, 从旧版本升级, 卸载, 参考文件,
 * 回复骨架与自查.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  LEGACY_COMMAND_PATH,
  LEGACY_HOOK_ENTRY_ARGUMENT,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/paths.mjs";
import { NAVIGATOR_PERMISSION_RULES } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/settings.mjs";
import {
  commandSkeleton,
  commitPaths,
  createTemporaryDirectory,
  createTemporaryRepository,
  initializeProject,
  runCommand,
  runGit,
  runHook,
  writeTranscript,
} from "./helpers.mjs";

/**
 * 读取项目中的 JSON 文件.
 *
 * @param {string} root 项目根目录.
 * @param {string} relative 项目相对路径.
 * @returns {any} 解析后的内容.
 */
function readJson(root, relative) {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
}

/**
 * 写入项目中的文件, 目录不存在时先创建.
 *
 * @param {string} root 项目根目录.
 * @param {string} relative 项目相对路径.
 * @param {string} content 文件内容.
 * @returns {void}
 */
function writeProjectFile(root, relative, content) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

test("进入: 不在 Git 仓库中时提示先初始化仓库", (context) => {
  const directory = createTemporaryDirectory();
  context.after(directory.cleanup);
  const output = runCommand(["enter"], directory.root);
  assert.equal(output.status, 0);
  assert.match(output.stdout, /当前目录不是 Git 仓库/u);
  assert.match(output.stdout, /repo-init/u);
});

test("进入与初始化: 带编排标记, 初始化写入状态目录与放行规则, 之后回复首次接入", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const before = runCommand(["enter"], root).stdout;
  assert.match(before, /- 编排标记: project-navigator 编排标记 [0-9a-f]{12}/u);
  assert.match(before, /用户选 A 后运行 init/u);
  const init = runCommand(["init"], root).stdout;
  assert.match(init, /设置结果: 已写入/u);
  assert.match(init, /调用 waypoint:commit-message 提交 "初始化"/u);
  for (const file of [".claude/settings.json", ".claude/settings.local.json"]) {
    const allow = readJson(root, file).permissions.allow;
    for (const rule of NAVIGATOR_PERMISSION_RULES) {
      assert.ok(allow.includes(rule), `${file} 缺少 ${rule}`);
    }
    assert.equal(readJson(root, file).hooks, undefined, "不写项目级 hook");
  }
  assert.ok(existsSync(path.join(root, ".navigator", "plan", "glossary.md")));
  assert.ok(!existsSync(path.join(root, ".navigator", "bin")), "不复制脚本");
  const status = runCommand(["status"], root).stdout;
  assert.doesNotMatch(status, /编排标记/u, "status 不输出编排标记");
  assert.match(status, /- 下一动作: 回复 "首次接入" \(reply entry\)/u);
});

test("进入: 已有进度时, 调用技能先回复恢复进度; 会话中途的 status 给出实际的下一步", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { project } = initializeProject(repository.root);
  project(["stage", "1"]);
  assert.match(
    runCommand(["enter"], repository.root).stdout,
    /回复 "恢复进度" \(reply resume\)/u,
  );
  assert.match(project(["status"]).stdout, /继续阶段 1 的步骤 start/u);
});

test("初始化: 项目的忽略规则漏掉状态目录时不做任何改动", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  writeProjectFile(root, ".gitignore", ".navigator/\n");
  commitPaths(root, [".gitignore"], "ignore");
  const init = runCommand(["init"], root).stdout;
  assert.match(init, /设置结果: 未执行/u);
  assert.match(init, /\.gitignore:1: \.navigator\//u);
  assert.ok(!existsSync(path.join(root, ".navigator", "state.json")));
});

test("升级: 清理旧版本的 hook, 放行规则, 脚本副本, 会话登记与快照, 撤回等回执的工单", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const userHook = {
    matcher: "Write",
    hooks: [{ type: "command", command: "npx prettier --write" }],
  };
  writeProjectFile(
    root,
    ".claude/settings.json",
    JSON.stringify({
      permissions: {
        allow: ["Bash(npm test)", `Bash(node ${LEGACY_COMMAND_PATH} *)`],
      },
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: "node",
                args: [LEGACY_HOOK_ENTRY_ARGUMENT],
              },
            ],
          },
          userHook,
        ],
      },
    }),
  );
  writeProjectFile(root, ".navigator/bin/runtime/hook.mjs", "// old\n");
  writeProjectFile(root, ".navigator/guide/executor.md", "# 旧手册\n");
  writeProjectFile(
    root,
    ".navigator/state.json",
    JSON.stringify({
      schema: 4,
      revision: 3,
      skillVersion: "0.11.0",
      init: { status: "active", initializedAt: "2026-09-01T00:00:00.000Z" },
      stage: 5,
      step: "start",
      milestone: null,
      slice: null,
      order: {
        id: "0002",
        slug: "export",
        folder: "0002-export",
        kind: "implementation",
        slice: null,
        status: "issued",
        round: 1,
        baseCommit: "a".repeat(40),
        authorizedTests: ["npm test"],
      },
      milestones: [],
      slices: [],
      orders: [],
      risks: [],
      decisions: [],
      changes: [],
      codeChecks: { commands: ["npm run lint"], reason: null },
      evidenceTools: ["mcp__tool"],
      lastCommit: "a".repeat(40),
      stageCommit: null,
      lastAction: "工单 0002 转为 issued",
      updatedAt: "2026-09-01T00:00:00.000Z",
      skipped: [],
      next: {
        order: 3,
        milestone: 1,
        slice: 1,
        decision: 1,
        change: 1,
        risk: 1,
        checkup: 1,
      },
    }),
  );
  const gitDirectory = path.join(root, ".git", "navigator");
  writeProjectFile(root, ".git/navigator/orchestrator.json", "{}");
  writeProjectFile(root, ".git/navigator/prompts.json", "[]");
  runGit(root, ["update-ref", "refs/navigator/snapshots", "HEAD"]);
  const enter = runCommand(["enter"], root).stdout;
  assert.match(enter, /由旧版本 0\.11\.0 初始化, 需要升级/u);
  assert.match(enter, /用户选 A 后运行 init/u);
  assert.ok(
    !existsSync(path.join(gitDirectory, "orchestrator.json")),
    "进入时删掉旧的编排登记, 旧 hook 不再拦下升级命令",
  );
  const init = runCommand(["init"], root).stdout;
  assert.match(init, /设置结果: 已升级/u);
  assert.match(init, /清理旧版本: \.navigator\/bin\/, \.navigator\/guide\//u);
  const settings = readJson(root, ".claude/settings.json");
  assert.deepEqual(settings.hooks, { PreToolUse: [userHook] });
  assert.ok(settings.permissions.allow.includes("Bash(npm test)"));
  assert.ok(
    !settings.permissions.allow.includes(`Bash(node ${LEGACY_COMMAND_PATH} *)`),
  );
  assert.ok(!existsSync(path.join(root, ".navigator", "bin")));
  assert.ok(!existsSync(path.join(gitDirectory, "prompts.json")));
  assert.throws(() =>
    runGit(root, ["rev-parse", "--verify", "refs/navigator/snapshots"]),
  );
  const state = readJson(root, ".navigator/state.json");
  assert.equal(state.order.status, "drafting");
  assert.equal(state.order.authorizedTests, undefined);
  for (const key of ["lastCommit", "stageCommit", "evidenceTools"]) {
    assert.ok(!(key in state), key);
  }
  assert.match(runCommand(["status"], root).stdout, /已初始化/u);
});

test("升级: 旧版本中提交中的工单读取时视为已通过并结束", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root, project } = {
    ...repository,
    ...initializeProject(repository.root),
  };
  const state = readJson(root, ".navigator/state.json");
  writeProjectFile(
    root,
    ".navigator/state.json",
    JSON.stringify({
      ...state,
      order: {
        id: "0001",
        slug: "demo",
        folder: "0001-demo",
        kind: "implementation",
        slice: null,
        status: "committing",
        round: 1,
        baseCommit: "a".repeat(40),
      },
    }),
  );
  const status = project(["status"]).stdout;
  assert.doesNotMatch(status, /工单状态/u);
  assert.match(status, /工单 无 \(上一张 0001 已结束, accepted\)/u);
});

test("卸载: 移除放行规则, 项目标为已卸载后插件的 hook 不做任何事", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  initializeProject(root);
  const transcript = writeTranscript(root, true);
  context.after(transcript.cleanup);
  const write = {
    session_id: "s",
    transcript_path: transcript.path,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(root, "src", "app.js"), content: "" },
  };
  assert.equal(
    runHook(write, root).output?.hookSpecificOutput?.permissionDecision,
    "deny",
  );
  assert.match(runCommand(["uninstall"], root).stdout, /已移除放行规则/u);
  assert.equal(
    readJson(root, ".claude/settings.local.json").permissions,
    undefined,
  );
  assert.equal(runHook(write, root).output, undefined);
  assert.match(runCommand(["enter"], root).stdout, /初始标记: 已卸载/u);
});

test("参考文件: ref 输出执行手册与参考文件, 未知名称列出可用的名称", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  assert.match(
    runCommand(["ref", "executor"], repository.root).stdout,
    /^# 执行手册/u,
  );
  assert.match(
    runCommand(["ref", "order-loop"], repository.root).stdout,
    /工单粒度/u,
  );
  const unknown = runCommand(["ref", "nothing"], repository.root);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /order-loop/u);
});

test("回复骨架: 标题下方是结论行与进展行, 结尾是选项块, 没有人类总结块", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  initializeProject(repository.root);
  const skeleton = commandSkeleton(
    runCommand(["reply", "entry"], repository.root).stdout,
  );
  assert.match(
    skeleton,
    /^# 首次接入\n\n结论: <待填写>\n\n阶段 无 · 里程 无 · 切片 无 · 工单 无\n/u,
  );
  assert.match(skeleton, /```\n\[如何开始\][\s\S]*```\n?$/u);
  assert.doesNotMatch(skeleton, /<- \+/u);
});

test("自查: check 带文件时只报告问题, 不分配体检编号, 不写状态", (context) => {
  const repository = createTemporaryRepository();
  context.after(repository.cleanup);
  const { root } = repository;
  const { project } = initializeProject(root);
  writeProjectFile(
    root,
    ".navigator/plan/brief.md",
    "# 项目简报\n\n一段文字.\n",
  );
  const before = readFileSync(path.join(root, ".navigator/state.json"), "utf8");
  const output = project(["check", ".navigator/plan/brief.md"]).stdout;
  assert.doesNotMatch(output, /体检编号/u);
  assert.match(output, /结构不符/u);
  assert.equal(
    readFileSync(path.join(root, ".navigator/state.json"), "utf8"),
    before,
  );
  assert.match(project(["check"]).stdout, /体检编号: 0001/u);
});
