/**
 * @file 命令行测试: 进入与初始化, 旧版本记录的归档, 忽略规则检查, 卸载, 参考文件,
 * 项目设置, 路线与决策.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { orchestratorMarker } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/orchestrator-marker.mjs";
import {
  DEFAULT_ROADMAP,
  DEFAULT_SETTINGS,
  commitPaths,
  createTemporaryDirectory,
  createTemporaryRepository,
  initializeProject,
  runCommand,
  startProject,
  writeDraft,
} from "./helpers.mjs";

/**
 * 1.x 写入的状态文件的样子.
 * @type {Readonly<Record<string, unknown>>}
 */
const LEGACY_STATE = Object.freeze({
  schema: 5,
  skillVersion: "1.5.0",
  init: { status: "active" },
});

test("命令行: 不在 Git 仓库中时 enter 以退出码 0 说明原因", () => {
  const { root, cleanup } = createTemporaryDirectory();
  try {
    const result = runCommand(["enter"], root);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /不是 Git 仓库/u);
    assert.match(runCommand(["init"], root).stdout, /设置结果: 未执行/u);
  } finally {
    cleanup();
  }
});

test("命令行: 未初始化时 enter 带编排标记并询问初始化, status 不带标记", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const entered = runCommand(["enter"], root).stdout;
    assert.ok(entered.includes(orchestratorMarker(root)));
    assert.match(entered, /询问用户是否在本项目初始化/u);
    assert.ok(
      !runCommand(["status"], root).stdout.includes(orchestratorMarker(root)),
    );
    assert.equal(runCommand(["setup"], root).status, 1);
    assert.equal(runCommand(["unknown"], root).status, 1);
    assert.equal(runCommand(["enter", "--bad-option"], root).status, 0);
  } finally {
    cleanup();
  }
});

test("命令行: init 写入状态目录与放行规则, 不复制脚本, 重复运行不出错", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    initializeProject(root);
    for (const file of [
      ".navigator/state.json",
      ".navigator/roadmap.md",
      ".navigator/.gitignore",
      ".claude/settings.json",
      ".claude/settings.local.json",
    ]) {
      assert.ok(existsSync(path.join(root, file)), file);
    }
    assert.ok(!existsSync(path.join(root, ".navigator/bin")));
    const settings = JSON.parse(
      readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
    );
    assert.ok(settings.permissions.allow.includes("Bash(project-navigator *)"));
    assert.equal(settings.hooks, undefined);
    assert.match(runCommand(["init"], root).stdout, /设置结果: 已写入/u);
    assert.match(
      runCommand(["init", "--archive"], root).stdout,
      /不需要 --archive/u,
    );
    const status = runCommand(["status"], root).stdout;
    assert.match(status, /当前进展: 阶段 立项/u);
    assert.match(status, /ref intake/u);
  } finally {
    cleanup();
  }
});

test("命令行: 旧版本的记录不读取, 用户同意后归档再初始化", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    mkdirSync(path.join(root, ".navigator/plan"), { recursive: true });
    writeFileSync(
      path.join(root, ".navigator/state.json"),
      JSON.stringify(LEGACY_STATE),
      "utf8",
    );
    writeFileSync(path.join(root, ".navigator/plan/brief.md"), "旧\n", "utf8");
    assert.match(runCommand(["enter"], root).stdout, /init --archive/u);
    assert.match(runCommand(["status"], root).stdout, /由旧版本 1\.5\.0 写入/u);
    assert.equal(runCommand(["setup"], root).status, 1);
    assert.match(runCommand(["init"], root).stdout, /设置结果: 未执行/u);
    const archived = runCommand(["init", "--archive"], root).stdout;
    assert.match(archived, /旧记录已改名为 \.navigator-1\.x\//u);
    assert.match(archived, /以及 \.navigator-1\.x/u);
    assert.equal(
      readFileSync(path.join(root, ".navigator-1.x/plan/brief.md"), "utf8"),
      "旧\n",
    );
    assert.match(runCommand(["status"], root).stdout, /阶段 立项/u);
  } finally {
    cleanup();
  }
});

test("命令行: 编排记录会被项目的忽略规则漏掉时, init 与 enter 都停下", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    writeFileSync(path.join(root, ".gitignore"), ".claude/\n", "utf8");
    const result = runCommand(["init"], root).stdout;
    assert.match(result, /设置结果: 未执行/u);
    assert.match(result, /\.claude\//u);
    assert.ok(!existsSync(path.join(root, ".navigator/state.json")));
    writeFileSync(path.join(root, ".gitignore"), "", "utf8");
    initializeProject(root);
    writeFileSync(
      path.join(root, ".gitignore"),
      "findings/\nslices/\n",
      "utf8",
    );
    assert.match(runCommand(["status"], root).stdout, /下一动作: 立项/u);
    writeFileSync(path.join(root, ".gitignore"), ".claude/rules/\n", "utf8");
    assert.match(
      runCommand(["status"], root).stdout,
      /下一动作: 告诉用户编排记录或项目配置会被 Git 忽略/u,
    );
  } finally {
    cleanup();
  }
});

test("命令行: 卸载移除放行规则并让 hook 停用, 记录保留, 重新 init 恢复", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    initializeProject(root);
    assert.match(runCommand(["uninstall"], root).stdout, /已移除放行规则/u);
    const settings = JSON.parse(
      readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
    );
    assert.equal(settings.permissions, undefined);
    assert.match(runCommand(["status"], root).stdout, /初始标记: 已卸载/u);
    assert.equal(runCommand(["setup"], root).status, 1);
    assert.match(runCommand(["init"], root).stdout, /已写入/u);
    assert.match(runCommand(["status"], root).stdout, /已初始化/u);
  } finally {
    cleanup();
  }
});

test("命令行: ref 输出参考文件, 实现手册附标点规则, 名称不存在时列出可用名称", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    for (const name of ["intake", "slice-loop", "change", "standards"]) {
      const result = runCommand(["ref", name], root);
      assert.equal(result.status, 0, name);
      assert.match(result.stdout, /^# /u, name);
    }
    const guide = runCommand(["ref", "executor"], root).stdout;
    assert.match(guide, /^# 实现手册/u);
    assert.match(guide, /# 标点与排版规则/u);
    const missing = runCommand(["ref", "nothing"], root);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /intake, slice-loop/u);
  } finally {
    cleanup();
  }
});

test("命令行: setup 按工程文件给出建议, 登记后按组织方式写入项目规范", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const { project } = initializeProject(root);
    assert.match(project(["setup"]).stdout, /组织建议: directories/u);
    writeFileSync(path.join(root, "app.vcxproj"), "<Project />", "utf8");
    commitPaths(root, ["app.vcxproj"], "vs");
    assert.match(
      project(["setup"]).stdout,
      /组织建议: filters .*app\.vcxproj/u,
    );
    const invalid = project([
      "setup",
      "--from",
      writeDraft(root, "bad.json", {
        organization: "filters",
        verification: { mode: "auto" },
      }),
    ]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /至少写一条/u);
    const rulesFile = path.join(root, ".claude/rules/engineering.md");
    const setup = (organization) =>
      project([
        "setup",
        "--from",
        writeDraft(root, "setup.json", {
          organization,
          verification: { mode: "manual" },
          conventions: ["注释用简体中文"],
        }),
      ]);
    assert.equal(setup("filters").status, 0);
    const filters = readFileSync(rulesFile, "utf8");
    assert.match(filters, /虚拟筛选器/u);
    assert.doesNotMatch(filters, /一个模块一个目录|begin:|end:/u);
    assert.match(filters, /## 项目约定\n\n- 注释用简体中文/u);
    assert.equal(setup("directories").status, 0);
    const directories = readFileSync(rulesFile, "utf8");
    assert.match(directories, /一个模块一个目录/u);
    assert.doesNotMatch(directories, /虚拟筛选器|begin:|end:/u);
    assert.match(project(["status"]).stdout, /验证方式为用户手动运行/u);
  } finally {
    cleanup();
  }
});

test("命令行: 路线要在需求与项目设置之后, 第一个切片必须是改代码的骨架", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const { project } = initializeProject(root);
    const roadmap = (draft) =>
      project(["roadmap", "--from", writeDraft(root, "roadmap.json", draft)]);
    assert.match(roadmap(DEFAULT_ROADMAP).stdout, /还没有需求文件/u);
    writeFileSync(
      path.join(root, ".navigator/requirements.md"),
      "# 需求\n",
      "utf8",
    );
    assert.match(project(["status"]).stdout, /登记项目设置/u);
    assert.match(roadmap(DEFAULT_ROADMAP).stdout, /请先运行 setup/u);
    project([
      "setup",
      "--from",
      writeDraft(root, "setup.json", DEFAULT_SETTINGS),
    ]);
    assert.match(project(["status"]).stdout, /写路线/u);
    assert.match(
      roadmap({
        milestones: [
          {
            name: "甲",
            goal: "乙",
            slices: [{ name: "查", kind: "findings" }],
          },
        ],
      }).stdout,
      /最小骨架, 种类必须是 build/u,
    );
    assert.match(
      roadmap({
        milestones: [
          {
            name: "甲",
            goal: "乙",
            slices: [{ name: "做", interactive: true }],
          },
        ],
      }).stdout,
      /不能是交互式/u,
    );
    assert.match(
      roadmap({ milestones: [{ name: "甲", goal: "乙" }] }).stdout,
      /排出它的全部切片/u,
    );
    const written = roadmap(DEFAULT_ROADMAP);
    assert.equal(written.status, 0, written.stdout);
    assert.match(written.stdout, /切片 0001: 最小骨架 \(最小骨架\)/u);
    assert.match(written.stdout, /提交步骤: .*立项完成/u);
    const view = readFileSync(path.join(root, ".navigator/roadmap.md"), "utf8");
    assert.match(view, /## 里程 0001: 能导出 \(进行中\)/u);
    assert.match(view, /- \[ \] 0003 查清格式 \(只产出结论, 交互式\)/u);
    assert.match(view, /切片到这个里程开始时再排/u);
  } finally {
    cleanup();
  }
});

test("命令行: decision add 登记决策并追加条目, 可以取代以前的决策", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const { project } = startProject(root);
    const add = (draft) =>
      project(["decision", "add", "--from", writeDraft(root, "d.json", draft)]);
    const first = {
      title: "用 CSV",
      decision: "导出格式用 CSV",
      reason: "用户要用表格软件打开",
      rejected: "JSON",
    };
    assert.equal(add(first).status, 0);
    assert.equal(
      add({ ...first, title: "改用 TSV", supersedes: "0001" }).status,
      0,
    );
    assert.match(add({ ...first, supersedes: "0009" }).stdout, /不存在/u);
    assert.match(add({ title: "缺字段" }).stdout, /不能为空/u);
    const text = readFileSync(
      path.join(root, ".navigator/decisions.md"),
      "utf8",
    );
    assert.match(text, /^# 决策记录/u);
    assert.match(text, /## 决策 0001: 用 CSV\n\n- 日期: \d{4}-\d{2}-\d{2}/u);
    assert.match(text, /## 决策 0002: 改用 TSV[\s\S]*- 取代: 决策 0001/u);
    const state = JSON.parse(
      readFileSync(path.join(root, ".navigator/state.json"), "utf8"),
    );
    assert.equal(state.decisions[0].supersededBy, "0002");
    assert.match(project(["decision"]).stdout, /decision add --from <草稿>/u);
  } finally {
    cleanup();
  }
});
