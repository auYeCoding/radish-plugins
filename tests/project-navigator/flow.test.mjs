/**
 * @file 端到端流程测试: 在临时仓库中用命令行与 hook 走完切片循环, 覆盖骨架,
 * 补做, 交互式切片, 里程复查与收尾.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_SETTINGS,
  createTemporaryRepository,
  fillSections,
  startProject,
  writeDraft,
  writeTranscript,
} from "./helpers.mjs";

/**
 * 改代码的切片填好的计划段.
 * @type {Readonly<Record<string, string>>}
 */
const BUILD_PLAN = Object.freeze({
  目标: "从命令行运行入口能看到一行输出.",
  完成标准: "1. 运行 node src/main.js 输出 ok.",
  明确不做: "无",
  需要决定: "无",
  模块安排: [
    "| 文件 | 模块 | 层 | 说明 |",
    "| --- | --- | --- | --- |",
    "| src/main.js | src | 表现 | 入口 |",
    "",
    "- 唯一定义: 无",
    "- 复用: 无",
  ].join("\n"),
  工作假设: "入口文件是 src/main.js.",
});

/**
 * 只产出结论的切片填好的计划段.
 * @type {Readonly<Record<string, string>>}
 */
const FINDINGS_PLAN = Object.freeze({
  目标: "查清导出文件的格式.",
  完成标准: "1. 写明每个字段的含义与依据.",
  明确不做: "无",
  需要决定: "无",
  结论位置: ".navigator/findings/format.md",
  工作假设: "格式在样例文件中能看出来.",
});

/**
 * 改代码的切片填好的执行结果段.
 * @type {Readonly<Record<string, string>>}
 */
const BUILD_RESULT = Object.freeze({
  执行状态: "完成",
  改动清单: "- 新增 src/main.js",
  接线证据: "- src/main.js:1 入口直接输出.",
  修正: [
    "| 计划原文 | 实际情况 | 证据位置 | 处理办法 |",
    "| --- | --- | --- | --- |",
    "| 无 | 无 | 无 | 无 |",
  ].join("\n"),
  待定标准: "无",
  自测记录: "- node src/main.js 输出 ok.",
  中途记录: "无",
});

/**
 * 只产出结论的切片填好的执行结果段.
 * @type {Readonly<Record<string, string>>}
 */
const FINDINGS_RESULT = Object.freeze({
  执行状态: "完成",
  改动清单: "- 新增 .navigator/findings/format.md",
  修正: BUILD_RESULT.修正,
  待定标准: "无",
  自测记录: "无",
  中途记录: "无",
});

/**
 * 生成验收段中除标准核对之外的内容.
 *
 * @param {boolean} isBuild 是否为改代码的切片.
 * @returns {Record<string, string>} 小节标题到内容的映射.
 */
function reviewRest(isBuild) {
  return {
    ...(isBuild ? { 接线核对: "已接线.", 结构核对: "没有问题." } : {}),
    范围核对: "与改动清单一致.",
    修正核对: "无",
    人工验收: "无",
  };
}

/**
 * 生成标准核对表.
 *
 * @param {string} verdict 结论.
 * @returns {string} 表格全文.
 */
function verdictTable(verdict) {
  return [
    "| 标准 | 结论 | 证据 |",
    "| --- | --- | --- |",
    `| 1 | ${verdict} | src/main.js:1 |`,
  ].join("\n");
}

/**
 * 从命令输出中取出某一行的内容.
 *
 * @param {string} output 命令输出.
 * @param {string} key 行首的键.
 * @returns {string} 键之后的内容.
 */
function line(output, key) {
  return (
    output
      .split("\n")
      .find((entry) => entry.startsWith(`- ${key}: `))
      ?.slice(key.length + 4) ?? ""
  );
}

/**
 * 运行命令并确认成功.
 *
 * @param {ReturnType<typeof startProject>} runner 调用命令行的函数.
 * @param {readonly string[]} args 参数.
 * @returns {string} 标准输出.
 */
function ok(runner, args) {
  const result = runner.project(args);
  assert.equal(result.status, 0, result.stdout);
  return result.stdout;
}

/**
 * 运行命令并确认被拒绝.
 *
 * @param {ReturnType<typeof startProject>} runner 调用命令行的函数.
 * @param {readonly string[]} args 参数.
 * @returns {string} 标准输出.
 */
function refused(runner, args) {
  const result = runner.project(args);
  assert.equal(result.status, 1, result.stdout);
  return result.stdout;
}

/**
 * 把一个切片从写计划走到验收通过.
 *
 * @param {object} options 参数.
 * @param {string} options.root 仓库根目录.
 * @param {ReturnType<typeof startProject>} options.runner 调用命令行的函数.
 * @param {string} options.id 切片编号.
 * @param {string} options.slug 短名.
 * @param {boolean} [options.isBuild] 是否为改代码的切片.
 * @returns {string} 切片文件的项目相对路径.
 */
function completeSlice({ root, runner, id, slug, isBuild = true }) {
  const file = `.navigator/slices/${id}-${slug}.md`;
  ok(runner, ["slice", "plan", id, "--slug", slug]);
  fillSections(root, file, isBuild ? BUILD_PLAN : FINDINGS_PLAN);
  ok(runner, ["slice", "start"]);
  fillSections(root, file, isBuild ? BUILD_RESULT : FINDINGS_RESULT);
  ok(runner, ["slice", "review"]);
  fillSections(root, file, {
    标准核对: verdictTable("通过"),
    ...reviewRest(isBuild),
    用户结论: "A, 通过并提交.",
  });
  ok(runner, ["slice", "accept"]);
  return file;
}

test("流程: 最小骨架从写计划到接受未验证的标准", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const runner = startProject(root);
    const file = ".navigator/slices/0001-skeleton.md";
    assert.match(
      line(ok(runner, ["status"]), "下一动作"),
      /slice plan 0001 --slug/u,
    );
    assert.match(
      refused(runner, ["slice", "plan", "0002", "--slug", "csv"]),
      /最小骨架/u,
    );
    ok(runner, ["slice", "plan", "0001", "--slug", "skeleton"]);
    assert.match(readFileSync(path.join(root, file), "utf8"), /最小骨架/u);
    assert.match(refused(runner, ["slice", "start"]), /还没有填好: 目标/u);
    fillSections(root, file, BUILD_PLAN);
    assert.match(ok(runner, ["slice", "start"]), /navigator-executor/u);
    const brief = ok(runner, ["brief", "exec"]);
    assert.match(brief, /最小骨架: 是/u);
    assert.match(brief, /0001-skeleton\.md/u);
    assert.match(line(ok(runner, ["status"]), "下一动作"), /等待实现子代理/u);
    assert.match(refused(runner, ["slice", "review"]), /不能送验/u);

    fillSections(root, file, BUILD_RESULT);
    fillSections(root, file, { 工作假设: "入口文件改成了 src/index.js." });
    assert.match(refused(runner, ["slice", "review"]), /slice replan/u);
    ok(runner, ["slice", "replan"]);
    assert.match(ok(runner, ["slice", "review"]), /navigator-reviewer/u);
    const reviewBrief = ok(runner, ["brief", "review"]);
    assert.match(reviewBrief, /git diff [0-9a-f]{40} --stat/u);
    assert.match(reviewBrief, /结构核对/u);
    assert.doesNotMatch(reviewBrief, /## 筛选器检查/u);
    assert.match(line(ok(runner, ["status"]), "下一动作"), /等待验收子代理/u);

    fillSections(root, file, {
      标准核对: verdictTable("未验证"),
      ...reviewRest(true),
    });
    assert.match(line(ok(runner, ["status"]), "下一动作"), /接受现状/u);
    assert.match(refused(runner, ["slice", "accept"]), /用户结论/u);
    fillSections(root, file, { 用户结论: "A, 接受现状." });
    assert.match(refused(runner, ["slice", "accept"]), /--accept-unverified/u);
    const accepted = ok(runner, ["slice", "accept", "--accept-unverified"]);
    assert.match(accepted, /commit-message/u);
    assert.match(
      line(ok(runner, ["status"]), "下一动作"),
      /slice plan 0002 --slug/u,
    );
    assert.match(
      readFileSync(path.join(root, ".navigator/roadmap.md"), "utf8"),
      /- \[x\] 0001 最小骨架/u,
    );
  } finally {
    cleanup();
  }
});

test("流程: 不通过的切片补做一轮后通过, 旧的验收归档在文件中", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const runner = startProject(root);
    completeSlice({ root, runner, id: "0001", slug: "skeleton" });
    const file = ".navigator/slices/0002-csv.md";
    ok(runner, ["slice", "plan", "0002", "--slug", "csv"]);
    fillSections(root, file, {
      ...BUILD_PLAN,
      需要决定: "分隔符用逗号还是制表符.",
    });
    assert.match(refused(runner, ["slice", "start"]), /--decided/u);
    ok(runner, ["slice", "start", "--decided"]);
    fillSections(root, file, BUILD_RESULT);
    ok(runner, ["slice", "review"]);
    fillSections(root, file, {
      标准核对: verdictTable("不通过"),
      ...reviewRest(true),
      用户结论: "A, 补做.",
    });
    assert.match(line(ok(runner, ["status"]), "下一动作"), /A 补做/u);
    assert.match(refused(runner, ["slice", "accept"]), /不能通过/u);
    assert.match(refused(runner, ["slice", "redo"]), /补做/u);
    fillSections(root, file, { 补做: "把输出接到入口上." });
    assert.match(ok(runner, ["slice", "redo"]), /第 2 轮/u);

    const text = readFileSync(path.join(root, file), "utf8");
    assert.match(text, /^## 验收 \(第 1 轮\)$/mu);
    assert.match(text, /^## 验收$/mu);
    assert.match(text, /^补做中$/mu);
    assert.match(ok(runner, ["brief", "exec"]), /这是第 2 轮/u);
    assert.match(line(ok(runner, ["status"]), "下一动作"), /等待实现子代理/u);

    fillSections(root, file, { 执行状态: "完成" });
    ok(runner, ["slice", "review"]);
    assert.match(ok(runner, ["brief", "review"]), /与 "补做"/u);
    fillSections(root, file, {
      标准核对: verdictTable("通过"),
      ...reviewRest(true),
      用户结论: "A, 通过并提交.",
    });
    assert.match(line(ok(runner, ["status"]), "下一动作"), /验收全部通过/u);
    ok(runner, ["slice", "accept"]);
  } finally {
    cleanup();
  }
});

test("流程: 交互式切片在编排会话中做, 之后里程复查与收尾", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const runner = startProject(root, {
      roadmap: {
        milestones: [
          {
            name: "能导出",
            goal: "导出一份报表",
            slices: [
              { name: "最小骨架" },
              { name: "查清格式", kind: "findings" },
              { name: "多余的切片" },
            ],
          },
        ],
      },
    });
    completeSlice({ root, runner, id: "0001", slug: "skeleton" });
    const file = ".navigator/slices/0002-format.md";
    ok(runner, ["slice", "plan", "0002", "--slug", "format"]);
    const skeleton = readFileSync(path.join(root, file), "utf8");
    assert.match(skeleton, /### 结论位置/u);
    assert.doesNotMatch(skeleton, /### 模块安排|### 接线证据|### 结构核对/u);
    fillSections(root, file, FINDINGS_PLAN);
    assert.match(ok(runner, ["slice", "start"]), /在本会话/u);
    assert.match(refused(runner, ["brief", "exec"]), /交互式切片/u);
    assert.match(
      line(ok(runner, ["status"]), "下一动作"),
      /继续交互式切片 0002/u,
    );
    fillSections(root, file, FINDINGS_RESULT);
    ok(runner, ["slice", "review"]);
    assert.match(ok(runner, ["brief", "review"]), /结论核对/u);
    fillSections(root, file, {
      标准核对: verdictTable("通过"),
      ...reviewRest(false),
      用户结论: "A.",
    });
    ok(runner, ["slice", "accept"]);

    ok(runner, ["slice", "plan", "0003", "--slug", "extra"]);
    ok(runner, ["slice", "drop"]);
    assert.match(line(ok(runner, ["status"]), "下一动作"), /里程复查/u);
    assert.match(refused(runner, ["finish"]), /还没有完成/u);
    assert.match(refused(runner, ["milestone", "done", "0002"]), /0001/u);
    ok(runner, ["milestone", "done", "0001"]);
    assert.match(line(ok(runner, ["status"]), "下一动作"), /finish/u);
    assert.match(ok(runner, ["finish"]), /项目收尾/u);
    assert.match(line(ok(runner, ["status"]), "当前进展"), /已收尾/u);
    assert.match(ok(runner, ["check"]), /没有问题/u);
  } finally {
    cleanup();
  }
});

test("流程: 最小骨架不能放弃, 里程完成后要为下一个里程排切片", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const runner = startProject(root, {
      roadmap: {
        milestones: [
          { name: "骨架", goal: "跑通", slices: [{ name: "最小骨架" }] },
          { name: "功能", goal: "加功能" },
        ],
      },
    });
    ok(runner, ["slice", "plan", "0001", "--slug", "skeleton"]);
    assert.match(refused(runner, ["slice", "drop"]), /最小骨架/u);
    fillSections(root, ".navigator/slices/0001-skeleton.md", BUILD_PLAN);
    ok(runner, ["slice", "start"]);
    fillSections(root, ".navigator/slices/0001-skeleton.md", BUILD_RESULT);
    ok(runner, ["slice", "review"]);
    fillSections(root, ".navigator/slices/0001-skeleton.md", {
      标准核对: verdictTable("不通过"),
      ...reviewRest(true),
    });
    assert.match(line(ok(runner, ["status"]), "下一动作"), /只能补做/u);
    fillSections(root, ".navigator/slices/0001-skeleton.md", {
      标准核对: verdictTable("通过"),
      用户结论: "A.",
    });
    ok(runner, ["slice", "accept"]);
    ok(runner, ["milestone", "done", "0001"]);
    assert.match(
      line(ok(runner, ["status"]), "下一动作"),
      /为里程 0002 "功能" 排出切片/u,
    );
    const draft = writeDraft(root, "next.json", {
      milestones: [
        {
          id: "0001",
          name: "骨架",
          goal: "跑通",
          slices: [{ id: "0001", name: "最小骨架" }],
        },
        {
          id: "0002",
          name: "功能",
          goal: "加功能",
          slices: [{ name: "导出" }],
        },
      ],
    });
    ok(runner, ["roadmap", "--from", draft]);
    assert.match(
      line(ok(runner, ["status"]), "下一动作"),
      /slice plan 0002 --slug/u,
    );
  } finally {
    cleanup();
  }
});

test("流程: 守卫按四条规则放行与拒绝", () => {
  const { root, cleanup } = createTemporaryRepository();
  const orchestrator = writeTranscript(root, true);
  const other = writeTranscript(root, false);
  try {
    const runner = startProject(root);
    ok(runner, ["slice", "plan", "0001", "--slug", "skeleton"]);
    const sliceFile = path.join(root, ".navigator/slices/0001-skeleton.md");
    const write = (filePath, extra) =>
      runner.hook({
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: filePath },
        transcript_path: orchestrator.path,
        ...extra,
      }).output?.hookSpecificOutput.permissionDecision;
    const executor = {
      agent_id: "a1",
      agent_type: "waypoint:navigator-executor",
    };
    const reviewer = {
      agent_id: "a2",
      agent_type: "waypoint:navigator-reviewer",
    };
    assert.equal(write(path.join(root, "src/main.js")), "deny");
    assert.equal(write(sliceFile), undefined);
    assert.equal(write(path.join(root, ".navigator/state.json")), "deny");
    assert.equal(
      write(path.join(root, ".navigator/roadmap.md"), executor),
      "deny",
    );
    assert.equal(write(path.join(root, "src/main.js"), executor), undefined);
    assert.equal(write(sliceFile, executor), undefined);
    assert.equal(
      write(path.join(root, ".navigator/findings/a.md"), executor),
      undefined,
    );
    assert.equal(
      write(path.join(root, ".navigator/requirements.md"), executor),
      "deny",
    );
    assert.equal(write(path.join(root, "notes.md"), reviewer), "deny");
    assert.equal(
      write(path.join(root, "src/main.js"), { transcript_path: other.path }),
      undefined,
    );
    assert.equal(
      runner.hook({
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: path.join(root, "src/main.js") },
        transcript_path: orchestrator.path,
      }).output,
      undefined,
    );
  } finally {
    orchestrator.cleanup();
    other.cleanup();
    cleanup();
  }
});

test("流程: hook 只向编排会话注入位置与下一动作", () => {
  const { root, cleanup } = createTemporaryRepository();
  const orchestrator = writeTranscript(root, true);
  const other = writeTranscript(root, false);
  try {
    const bare = { hook_event_name: "UserPromptSubmit", prompt: "继续" };
    const runner = startProject(root);
    const context = (input) =>
      runner.hook(input).output?.hookSpecificOutput.additionalContext;
    const prompted = context({ ...bare, transcript_path: orchestrator.path });
    assert.match(prompted, /位置: 里程 0001 能导出 \(0\/3\)/u);
    assert.match(prompted, /下一动作: 为切片 0001/u);
    assert.doesNotMatch(prompted, /上下文已压缩/u);
    assert.equal(context({ ...bare, transcript_path: other.path }), undefined);
    assert.equal(
      context({ ...bare, transcript_path: orchestrator.path, agent_id: "a" }),
      undefined,
    );
    assert.match(
      context({
        hook_event_name: "SessionStart",
        source: "compact",
        transcript_path: orchestrator.path,
      }),
      /上下文已压缩/u,
    );
    ok(runner, ["uninstall"]);
    assert.equal(
      context({ ...bare, transcript_path: orchestrator.path }),
      undefined,
    );
  } finally {
    orchestrator.cleanup();
    other.cleanup();
    cleanup();
  }
});

test("流程: 用筛选器分模块的项目, 验收提示词带筛选器检查的结果", () => {
  const { root, cleanup } = createTemporaryRepository();
  try {
    const runner = startProject(root, {
      settings: { ...DEFAULT_SETTINGS, organization: "filters" },
    });
    const file = ".navigator/slices/0001-skeleton.md";
    ok(runner, ["slice", "plan", "0001", "--slug", "skeleton"]);
    fillSections(root, file, BUILD_PLAN);
    ok(runner, ["slice", "start"]);
    mkdirSync(path.join(root, "core"), { recursive: true });
    writeFileSync(path.join(root, "core/a.cpp"), "", "utf8");
    writeFileSync(path.join(root, "b.cpp"), "", "utf8");
    writeFileSync(
      path.join(root, "app.vcxproj"),
      '<Project><ItemGroup><ClCompile Include="core\\a.cpp" /><ClCompile Include="b.cpp" /></ItemGroup></Project>',
      "utf8",
    );
    writeFileSync(
      path.join(root, "app.vcxproj.filters"),
      '<Project><ItemGroup><ClCompile Include="b.cpp"><Filter>Core</Filter></ClCompile></ItemGroup></Project>',
      "utf8",
    );
    fillSections(root, file, BUILD_RESULT);
    ok(runner, ["slice", "review"]);
    const brief = ok(runner, ["brief", "review"]);
    assert.match(brief, /## 筛选器检查/u);
    assert.match(brief, /core\\a\.cpp 没有归入任何筛选器/u);
    assert.match(brief, /core\\a\.cpp 没有平铺/u);
    assert.doesNotMatch(brief, /b\.cpp 没有/u);
    assert.match(ok(runner, ["check", "--filters"]), /2 个问题/u);
    assert.equal(
      existsSync(path.join(root, ".claude/rules/engineering.md")),
      true,
    );
  } finally {
    cleanup();
  }
});
