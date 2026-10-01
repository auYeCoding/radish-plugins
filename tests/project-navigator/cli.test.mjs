/**
 * @file 命令行与 hook 的端到端测试: 在临时仓库中走通 初始化 → 自检 → 登记 → 卸载.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { COMMAND_HANDLERS } from "../../plugins/waypoint/skills/project-navigator/runtime/commands/handlers.mjs";
import {
  COMMAND_ACCESS,
  isOrchestratorOnly,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/command-access.mjs";
import {
  PLUGIN_COMMAND,
  PROBE_FILE,
  PROJECT_COMMAND,
  PROJECT_HOOK,
  commitPaths,
  createTemporaryDirectory,
  createTemporaryRepository,
  initializeProject,
  runCommand,
  runGit,
  runHook,
} from "./helpers.mjs";

/**
 * 测试中使用的编排会话编号.
 * @type {string}
 */
const SESSION_ID = "session-orchestrator";

/**
 * 模拟旧版本项目时写入的版本号.
 * @type {string}
 */
const OLD_VERSION = "0.0.1";

/**
 * 项目中运行脚本副本的版本文件, 相对于项目根目录.
 * @type {string}
 */
const VERSION_FILE = ".navigator/bin/runtime-version.json";

/**
 * 旧版本副本中残留的文件, 相对于项目根目录; 升级会整目录替换, 残留文件随之消失.
 * @type {string}
 */
const STALE_FILE = ".navigator/bin/runtime/stale.mjs";

/**
 * 把已初始化的项目改成旧版本的样子: 版本文件与状态文件都记为旧版本, 副本中多出
 * 一个新版本没有的文件.
 *
 * @param {string} root 仓库根目录.
 * @returns {string} 降级之前的版本号.
 */
function downgradeProject(root) {
  const versionFile = path.join(root, VERSION_FILE);
  const stateFile = path.join(root, ".navigator", "state.json");
  const current = JSON.parse(readFileSync(versionFile, "utf8")).version;
  writeFileSync(versionFile, JSON.stringify({ version: OLD_VERSION }), "utf8");
  writeFileSync(
    stateFile,
    JSON.stringify({
      ...JSON.parse(readFileSync(stateFile, "utf8")),
      skillVersion: OLD_VERSION,
    }),
    "utf8",
  );
  writeFileSync(path.join(root, STALE_FILE), "export {};\n", "utf8");
  return current;
}

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
    assert.match(entered.stdout, /回复 "阶段提交".+提交 "初始化" 的成果/u);
    const project = (args) =>
      runCommand(path.join(root, PROJECT_COMMAND), args, root);
    assert.equal(project(["stage", "0"]).status, 1, "阶段提交之前不能推进");
    const skill = runHook(
      path.join(root, PROJECT_HOOK),
      {
        session_id: SESSION_ID,
        hook_event_name: "PreToolUse",
        tool_name: "Skill",
        tool_input: { skill: "waypoint:commit-message" },
      },
      root,
    );
    assert.equal(
      skill.output.hookSpecificOutput.permissionDecision,
      "deny",
      "用户选择之前不能调用 commit-message",
    );
    assert.equal(project(["stagecommit", "start"]).status, 0);
    assert.equal(
      runHook(
        path.join(root, PROJECT_HOOK),
        {
          session_id: SESSION_ID,
          hook_event_name: "PreToolUse",
          tool_name: "Skill",
          tool_input: { skill: "waypoint:commit-message" },
        },
        root,
      ).output,
      undefined,
      "阶段提交中可以调用 commit-message",
    );
    const early = project(["stagecommit", "done"]);
    assert.equal(early.status, 1, "记录没有入库时不能收尾");
    assert.match(early.stdout, /没有随提交入库/u);
    const head = commitPaths(
      root,
      [".navigator", ".claude/settings.json"],
      "chore: 接入编排",
    );
    assert.equal(project(["stagecommit", "done"]).status, 0);
    const status = project(["status"]).stdout;
    assert.match(status, /回复 "首次接入"/u);
    assert.match(status, new RegExp(`记录提交: ${head.slice(0, 7)}`, "u"));

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
    assert.match(
      blocked.output.hookSpecificOutput.permissionDecisionReason,
      /已不是编排会话/u,
    );
    const reminded = runHook(
      path.join(root, PROJECT_HOOK),
      {
        session_id: SESSION_ID,
        hook_event_name: "UserPromptSubmit",
        prompt: "继续",
      },
      root,
    );
    assert.match(
      reminded.output.hookSpecificOutput.additionalContext,
      /已不是编排会话.+接管时间/u,
      "被接管的旧会话收到消息时得到提醒",
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

test("命令行: 升级时把旧状态文件中的会话登记迁移到运行期登记目录", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    initializeProject(root, SESSION_ID);
    const stateFile = path.join(root, ".navigator", "state.json");
    const registryFile = path.join(
      root,
      ".git",
      "navigator",
      "orchestrator.json",
    );
    writeFileSync(
      stateFile,
      JSON.stringify({
        ...JSON.parse(readFileSync(stateFile, "utf8")),
        schema: 2,
        session: { id: "legacy", claimedAt: "2026-09-25T00:00:00.000Z" },
        formerSessions: ["older"],
      }),
      "utf8",
    );
    rmSync(registryFile);
    const writeBrief = (sessionId) =>
      runHook(
        path.join(root, PROJECT_HOOK),
        {
          session_id: sessionId,
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: {
            file_path: path.join(root, ".navigator", "plan", "notes.md"),
            content: "x",
          },
        },
        root,
      ).output?.hookSpecificOutput?.permissionDecisionReason ?? "";
    assert.equal(
      writeBrief("legacy"),
      "",
      "旧登记中的编排会话仍是编排会话, 可以写记录",
    );
    assert.match(writeBrief("older"), /已不是编排会话/u);
    runCommand(PLUGIN_COMMAND, ["init", "--session", "session-new"], root);
    const registry = JSON.parse(readFileSync(registryFile, "utf8"));
    assert.equal(registry.current.id, "session-new");
    assert.deepEqual(registry.former.sort(), ["legacy", "older"]);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(state.session, undefined, "状态文件不再记录会话");
    assert.equal(state.formerSessions, undefined);
    assert.equal(state.schema, 4);
  } finally {
    repository.cleanup();
  }
});

test("命令行: 仓库还没有提交时, 初始化之后的阶段提交完成首次提交", () => {
  const directory = createTemporaryDirectory();
  const root = directory.root;
  try {
    runGit(root, ["init", "-q", "-b", "main"]);
    runCommand(PLUGIN_COMMAND, ["init", "--session", SESSION_ID], root);
    runHook(
      path.join(root, PROJECT_HOOK),
      {
        session_id: SESSION_ID,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(root, PROBE_FILE), content: "x" },
      },
      root,
    );
    const project = (args) =>
      runCommand(path.join(root, PROJECT_COMMAND), args, root);
    assert.match(project(["init", "--verify"]).stdout, /自检结果: 通过/u);
    assert.match(project(["status"]).stdout, /提交 "初始化" 的成果/u);
    assert.equal(project(["stagecommit", "start"]).status, 0);
    const head = commitPaths(
      root,
      [".navigator", ".claude/settings.json"],
      "chore: 首次提交",
    );
    assert.equal(project(["stagecommit", "done"]).status, 0);
    assert.equal(
      runGit(root, ["status", "--porcelain", "--", ".navigator"]),
      "",
      "首次提交完成后状态文件不留在工作区",
    );
    const status = project(["status"]).stdout;
    assert.match(status, /对账结果: 一致/u);
    assert.match(status, new RegExp(`记录提交: ${head.slice(0, 7)}`, "u"));
    assert.equal(
      project(["order", "new", "--kind", "runcheck", "--slug", "runcheck"])
        .status,
      0,
      "首次提交之后可以新建工单",
    );
  } finally {
    directory.cleanup();
  }
});

test("命令行: 项目规则忽略 lib/, bin/ 与各类文件时, init 写入的文件仍能入库, 草稿与杂项文件不入库", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    writeFileSync(
      path.join(root, ".gitignore"),
      [
        "lib/",
        "bin/",
        "*.mjs",
        ".navigator/**/*.json",
        ".navigator/**/*.md",
        ".DS_Store",
        "*.py",
        "*.har",
        "",
      ].join("\n"),
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
    assert.equal(
      isIgnored(".navigator/orders/0001-x/artifacts/repro.py"),
      false,
      "证据文件不论类型都能入库",
    );
    assert.equal(
      isIgnored(".navigator/orders/0001-x/artifacts/capture/record.har"),
      false,
    );
    assert.equal(isIgnored(".navigator/orders/0001-x/notes.py"), true);
    assert.equal(isIgnored(".navigator/drafts/roadmap.json"), true);
    assert.equal(isIgnored(".navigator/plan/.DS_Store"), true);
    assert.equal(isIgnored("lib/app.py"), true, "项目自己的规则不受影响");
  } finally {
    repository.cleanup();
  }
});

test("命令行: 初始化之后项目规则开始忽略插件文件时, 进入编排会被拦下并报出规则", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    initializeProject(root, SESSION_ID);
    const before = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    );
    assert.doesNotMatch(before.stdout, /运行受阻/u);
    writeFileSync(path.join(root, ".gitignore"), ".claude/\n", "utf8");
    const after = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    );
    assert.equal(after.status, 0);
    assert.match(after.stdout, /下一动作: 回复 "运行受阻"/u);
    assert.match(after.stdout, /\.gitignore:1: \.claude\//u);
  } finally {
    repository.cleanup();
  }
});

test("命令行: 项目规则忽略插件管理的项目配置时, init 同样停下报告", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    writeFileSync(path.join(root, ".gitignore"), "*.json\n", "utf8");
    commitPaths(root, [".gitignore"], "ignore json");
    const init = runCommand(
      PLUGIN_COMMAND,
      ["init", "--session", SESSION_ID],
      root,
    );
    assert.match(init.stdout, /设置结果: 未执行/u);
    assert.match(init.stdout, /例如 \.claude\/settings\.json/u);
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

test("命令行: 运行脚本较旧时下一动作写出技能目录中的完整升级命令, 照抄即可升级", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    const { project, hook } = initializeProject(root, SESSION_ID);
    const current = downgradeProject(root);
    const entered = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    ).stdout;
    assert.ok(
      entered.includes(`较旧 (${OLD_VERSION}), 需要升级到 ${current}`),
      entered,
    );
    assert.match(entered, /回复 "初始设置", 使用第 1 组选项/u);
    assert.match(entered, /不能换成 \.navigator\/bin\/ 下的副本/u);
    const command = /node "([^"]+)" init --session "([^"]+)"/u.exec(entered);
    assert.ok(command, entered);
    assert.equal(path.resolve(command[1]), path.resolve(PLUGIN_COMMAND));
    assert.equal(command[2], SESSION_ID);

    const upgraded = runCommand(
      command[1],
      ["init", "--session", command[2]],
      root,
    );
    assert.equal(upgraded.status, 0, upgraded.stdout);
    assert.match(upgraded.stdout, /设置结果: 已升级/u);
    assert.ok(upgraded.stdout.includes(`技能版本: ${current}`));
    assert.equal(
      JSON.parse(readFileSync(path.join(root, VERSION_FILE), "utf8")).version,
      current,
    );
    assert.equal(
      existsSync(path.join(root, STALE_FILE)),
      false,
      "升级整目录替换运行脚本",
    );
    hook({
      session_id: SESSION_ID,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: path.join(root, PROBE_FILE), content: "x" },
    });
    assert.match(project(["init", "--verify"]).stdout, /自检结果: 通过/u);
    const status = project(["status"]).stdout;
    assert.ok(status.includes(`已初始化, 版本 ${current}`), status);
    assert.doesNotMatch(status, /较旧/u);
  } finally {
    repository.cleanup();
  }
});

test("命令行: 用项目中的副本运行 init 被拒绝, 项目没有改动", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    const { project } = initializeProject(root, SESSION_ID);
    downgradeProject(root);
    const stateFile = path.join(root, ".navigator", "state.json");
    const before = readFileSync(stateFile, "utf8");
    const refused = project(["init", "--session", SESSION_ID]);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stdout, /init 只能用技能目录中的脚本运行/u);
    assert.ok(refused.stdout.includes(`副本 (版本 ${OLD_VERSION})`));
    assert.ok(
      refused.stdout.includes(
        `node "<技能目录>/runtime/navigator.mjs" init --session "${SESSION_ID}"`,
      ),
      refused.stdout,
    );
    assert.doesNotMatch(refused.stdout, /已升级/u);
    assert.equal(readFileSync(stateFile, "utf8"), before, "状态文件没有改动");
    assert.equal(
      JSON.parse(readFileSync(path.join(root, VERSION_FILE), "utf8")).version,
      OLD_VERSION,
    );
    assert.ok(existsSync(path.join(root, STALE_FILE)), "副本没有被替换");
  } finally {
    repository.cleanup();
  }
});

test("命令行: 防护配置缺失时, 下一动作同样写出修复用的 init 命令", () => {
  const repository = createTemporaryRepository();
  const root = repository.root;
  try {
    const { project } = initializeProject(root, SESSION_ID);
    rmSync(path.join(root, ".claude", "settings.json"));
    const entered = runCommand(
      PLUGIN_COMMAND,
      ["enter", "--session", SESSION_ID],
      root,
    ).stdout;
    assert.match(entered, /防护配置: 未安装/u);
    assert.match(entered, /初始化不完整, 防护配置需要修复/u);
    const command = /node "([^"]+)" init --session "([^"]+)"/u.exec(entered);
    assert.ok(command, entered);
    assert.equal(path.resolve(command[1]), path.resolve(PLUGIN_COMMAND));
    const status = project(["status"]).stdout;
    assert.match(
      status,
      /按技能内容 "初始设置" 第 2 步的命令运行 init/u,
      "副本写不出技能目录, 指向技能内容中的命令",
    );
    assert.equal(
      runCommand(command[1], ["init", "--session", command[2]], root).status,
      0,
    );
    assert.ok(existsSync(path.join(root, ".claude", "settings.json")));
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

test("命令行: 每条命令都登记了访问级别, 访问级别表中没有多余的命令", () => {
  assert.deepEqual(
    Object.keys(COMMAND_HANDLERS).sort(),
    Object.keys(COMMAND_ACCESS).sort(),
  );
  for (const name of ["status", "reply", "template", "evidence", "snapshots"]) {
    assert.equal(isOrchestratorOnly(name), false, `${name} 所有会话都能运行`);
  }
  for (const name of ["init", "enter", "order", "restore", "adopt"]) {
    assert.equal(isOrchestratorOnly(name), true, `${name} 只有编排会话能运行`);
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
