/**
 * @file 命令行与 hook 的端到端测试: 在临时仓库中走通 初始化 → 自检 → 登记 → 卸载.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  PLUGIN_COMMAND,
  PROBE_FILE,
  PROJECT_COMMAND,
  PROJECT_HOOK,
  commitPaths,
  createTemporaryDirectory,
  createTemporaryRepository,
  runCommand,
  runHook,
} from "./helpers.mjs";

/**
 * 测试中使用的编排会话编号.
 * @type {string}
 */
const SESSION_ID = "session-orchestrator";

test("命令行: 非 Git 目录中 enter 提示先初始化仓库, 且退出码为 0", () => {
  const directory = createTemporaryDirectory();
  try {
    const result = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      directory.root,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /不是 Git 仓库/u);
  } finally {
    directory.cleanup();
  }
});

test("命令行: enter 的参数有误时仍以退出码 0 结束", () => {
  const repository = createTemporaryRepository();
  try {
    const result = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--unknown"],
      repository.root,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /脚本错误/u);
  } finally {
    repository.cleanup();
  }
});

test("命令行: 初始化, 自检, 登记与卸载的完整流程", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    const before = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    );
    assert.match(before.stdout, /初始标记: 未找到/u);
    assert.match(before.stdout, /回复 "初始设置"/u);

    const init = runCommand(
      PLUGIN_COMMAND,
      ["init", "--session", SESSION_ID],
      root,
    );
    assert.equal(init.status, 0);
    assert.ok(existsSync(path.join(root, PROJECT_HOOK)));
    assert.ok(existsSync(path.join(root, ".navigator", "state.json")));
    const settings = JSON.parse(
      readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    );
    assert.ok(Array.isArray(settings.hooks.PreToolUse));
    assert.ok(settings.permissions.allow.length > 0, "入库配置含放行规则");
    const localSettings = JSON.parse(
      readFileSync(path.join(root, ".claude", "settings.local.json"), "utf8"),
    );
    assert.equal(localSettings.hooks, undefined, "本机配置不写 hook");
    assert.deepEqual(
      localSettings.permissions.allow,
      settings.permissions.allow,
    );
    const ignoreCheck = spawnSync(
      "git",
      ["check-ignore", "-q", ".claude/settings.local.json"],
      { cwd: root },
    );
    assert.equal(ignoreCheck.status, 0, "本机配置应被 Git 忽略");

    const pending = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    );
    assert.match(pending.stdout, /完成自检/u);

    const failedVerify = runCommand(
      path.join(root, PROJECT_COMMAND),
      ["init", "--verify"],
      root,
    );
    assert.match(failedVerify.stdout, /自检结果: 未通过/u);

    const probe = runHook(
      path.join(root, PROJECT_HOOK),
      {
        session_id: SESSION_ID,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(root, PROBE_FILE), content: "x" },
      },
      root,
    );
    assert.equal(probe.output.hookSpecificOutput.permissionDecision, "deny");

    const verify = runCommand(
      path.join(root, PROJECT_COMMAND),
      ["init", "--verify"],
      root,
    );
    assert.match(verify.stdout, /自检结果: 通过/u);

    const entered = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    );
    assert.match(entered.stdout, /本会话是编排会话/u);
    assert.match(entered.stdout, /回复 "首次接入"/u);

    const takeover = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", "session-new"],
      root,
    );
    assert.match(takeover.stdout, /本会话是编排会话/u);
    const blocked = runHook(
      path.join(root, PROJECT_HOOK),
      {
        session_id: SESSION_ID,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          file_path: path.join(root, ".navigator", "plan", "brief.md"),
        },
      },
      root,
    );
    assert.equal(
      blocked.output.hookSpecificOutput.permissionDecision,
      "deny",
      "被接管的旧会话不能再写编排记录",
    );

    const uninstall = runCommand(
      path.join(root, PROJECT_COMMAND),
      ["uninstall"],
      root,
    );
    assert.match(uninstall.stdout, /已移除 hook 与放行规则/u);
    const after = JSON.parse(
      readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    );
    assert.deepEqual(after, {}, "卸载后入库配置恢复为空");
    const localAfter = JSON.parse(
      readFileSync(path.join(root, ".claude", "settings.local.json"), "utf8"),
    );
    assert.deepEqual(localAfter, {}, "卸载后本机配置恢复为空");
    assert.ok(
      existsSync(path.join(root, ".navigator", "state.json")),
      "卸载保留记录",
    );
  } finally {
    repository.cleanup();
  }
});

test("命令行: 项目规则忽略 lib/, bin/ 与各类文件时, init 写入的文件仍能入库, 草稿与杂项文件不入库", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    writeFileSync(
      path.join(root, ".gitignore"),
      ["lib/", "bin/", "*.json", "*.md", "*.mjs", ".DS_Store", ""].join("\n"),
      "utf8",
    );
    commitPaths(root, [".gitignore"], "ignore rules");
    const init = runCommand(
      PLUGIN_COMMAND,
      ["init", "--session", SESSION_ID],
      root,
    );
    assert.match(init.stdout, /设置结果: 已写入/u, init.stdout);
    const written = readdirSync(path.join(root, ".navigator"), {
      recursive: true,
    })
      .map(
        (relative) =>
          `.navigator/${String(relative).split(path.sep).join("/")}`,
      )
      .filter((relative) => statSync(path.join(root, relative)).isFile());
    const ignored = spawnSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      input: written.join("\n"),
      encoding: "utf8",
    }).stdout.trim();
    assert.ok(written.length > 0);
    assert.equal(ignored, "", "init 写入的文件都应能入库");
    const isIgnored = (relative) =>
      spawnSync("git", ["check-ignore", "-q", relative], { cwd: root })
        .status === 0;
    assert.equal(isIgnored(".navigator/orders/0001-x/review.md"), false);
    assert.equal(isIgnored(".navigator/drafts/roadmap.json"), true);
    assert.equal(isIgnored(".navigator/plan/.DS_Store"), true);
    assert.equal(isIgnored("lib/app.py"), true, "项目自己的规则不受影响");
  } finally {
    repository.cleanup();
  }
});

test("命令行: 项目规则忽略整个状态目录时, init 报告规则并且不写入其它文件", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    writeFileSync(path.join(root, ".gitignore"), ".navigator/\n", "utf8");
    commitPaths(root, [".gitignore"], "ignore navigator");
    const init = runCommand(
      PLUGIN_COMMAND,
      ["init", "--session", SESSION_ID],
      root,
    );
    assert.equal(init.status, 0);
    assert.match(init.stdout, /设置结果: 未执行/u);
    assert.match(init.stdout, /忽略规则: \.gitignore:1: \.navigator\//u);
    assert.equal(
      existsSync(path.join(root, ".navigator", "state.json")),
      false,
    );
    assert.equal(
      existsSync(path.join(root, ".claude", "settings.json")),
      false,
    );
  } finally {
    repository.cleanup();
  }
});

test("命令行: reply 输出的骨架包含进展与固定选项", () => {
  const repository = createTemporaryRepository();
  try {
    const result = runCommand(
      PLUGIN_COMMAND,
      ["reply", "首次接入"],
      repository.root,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^# 首次接入$/mu);
    assert.match(result.stdout, /^- 当前阶段: 无$/mu);
    assert.match(result.stdout, /^A\. 新建项目, 从立项开始\.$/mu);
  } finally {
    repository.cleanup();
  }
});

test("命令行: reply 在骨架前给出填写要求, 只有编排会话的要求含写作规则", () => {
  const repository = createTemporaryRepository();
  try {
    const orchestrator = runCommand(
      PLUGIN_COMMAND,
      ["reply", "entry"],
      repository.root,
    ).stdout;
    assert.match(orchestrator, /^填写要求:/u);
    assert.match(orchestrator, /人类总结.*不超过 \d+ 字/u);
    assert.match(orchestrator, /以下情况会被打回/u);
    assert.ok(
      orchestrator.indexOf("填写要求:") < orchestrator.search(/^# 首次接入$/mu),
    );
    const executor = runCommand(
      PLUGIN_COMMAND,
      ["reply", "align"],
      repository.root,
    ).stdout;
    assert.match(executor, /^填写要求:/u);
    assert.doesNotMatch(executor, /以下情况会被打回/u);
  } finally {
    repository.cleanup();
  }
});

test("命令行: reply 接受英文编号", () => {
  const repository = createTemporaryRepository();
  try {
    const result = runCommand(
      PLUGIN_COMMAND,
      ["reply", "setup", "--option", "2"],
      repository.root,
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^# 初始设置$/mu);
    assert.match(result.stdout, /^\[如何继续\]$/mu);
  } finally {
    repository.cleanup();
  }
});

test("命令行: reply 不带参数时列出全部回复类型与编号", () => {
  const repository = createTemporaryRepository();
  try {
    const result = runCommand(PLUGIN_COMMAND, ["reply"], repository.root);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\| 初始设置 +\| setup +\|/u);
  } finally {
    repository.cleanup();
  }
});

test("命令行: 未知命令与未知回复类型以退出码 1 结束", () => {
  const repository = createTemporaryRepository();
  try {
    assert.equal(
      runCommand(PLUGIN_COMMAND, ["unknown"], repository.root).status,
      1,
    );
    assert.equal(
      runCommand(PLUGIN_COMMAND, ["reply", "随便写写"], repository.root).status,
      1,
    );
  } finally {
    repository.cleanup();
  }
});

test("hook: 未初始化的项目中一律放行", () => {
  const repository = createTemporaryRepository();
  try {
    const hookPath = path.join(path.dirname(PLUGIN_COMMAND), "hook.mjs");
    const result = runHook(
      hookPath,
      {
        session_id: SESSION_ID,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(repository.root, "src", "a.js") },
      },
      repository.root,
    );
    assert.equal(result.status, 0);
    assert.equal(result.output, undefined);
  } finally {
    repository.cleanup();
  }
});
