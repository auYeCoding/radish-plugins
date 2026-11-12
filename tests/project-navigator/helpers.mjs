/**
 * @file project-navigator 测试共用的辅助函数: 临时仓库, 调用命令行与 hook,
 * 模拟编排会话的转录, 写草稿, 填写切片文件.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orchestratorMarker } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/orchestrator-marker.mjs";
import {
  DRAFTS_DIRECTORY,
  REQUIREMENTS_FILE,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/paths.mjs";

/**
 * 插件中技能目录的绝对路径.
 * @type {string}
 */
export const SKILL_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "plugins",
  "waypoint",
  "skills",
  "project-navigator",
);

/**
 * 插件中命令行入口的绝对路径.
 * @type {string}
 */
export const PLUGIN_COMMAND = path.join(
  SKILL_DIRECTORY,
  "runtime",
  "navigator.mjs",
);

/**
 * 插件中 hook 入口的绝对路径.
 * @type {string}
 */
export const PLUGIN_HOOK = path.join(SKILL_DIRECTORY, "runtime", "hook.mjs");

/**
 * 临时仓库目录名中使用的前缀, 带空格与中文以覆盖路径处理.
 * @type {string}
 */
const TEMPORARY_PREFIX = "导航 测试-";

/**
 * 测试中登记的验证命令.
 * @type {string}
 */
export const VERIFY_COMMAND = "npm test";

/**
 * 测试中默认的项目设置: 物理目录, 自动测试.
 * @type {Readonly<Record<string, unknown>>}
 */
export const DEFAULT_SETTINGS = Object.freeze({
  organization: "directories",
  verification: { mode: "auto", commands: [VERIFY_COMMAND] },
});

/**
 * 测试中默认的路线: 一个里程, 骨架加一个改代码的切片与一个只产出结论的切片;
 * 之后还有一个没有排切片的里程.
 * @type {Readonly<Record<string, unknown>>}
 */
export const DEFAULT_ROADMAP = Object.freeze({
  milestones: [
    {
      name: "能导出",
      goal: "从命令行导出一份报表",
      slices: [
        { name: "最小骨架" },
        { name: "导出 CSV" },
        { name: "查清格式", kind: "findings" },
      ],
    },
    { name: "能筛选", goal: "按条件筛选导出内容" },
  ],
});

/**
 * 创建一个带一次提交的临时 Git 仓库.
 *
 * @returns {{root: string, cleanup: () => void}} 仓库根目录与清理函数.
 */
export function createTemporaryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), TEMPORARY_PREFIX));
  runGit(root, ["init", "-q", "-b", "main"]);
  writeFileSync(path.join(root, "README.md"), "# demo\n", "utf8");
  commitPaths(root, ["README.md"], "init");
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * 暂存指定路径并提交, 使用固定的测试身份.
 *
 * @param {string} root 仓库根目录.
 * @param {readonly string[]} paths 要暂存的路径.
 * @param {string} message 提交说明.
 * @returns {string} 新提交的哈希.
 */
export function commitPaths(root, paths, message) {
  runGit(root, ["add", "-f", "--", ...paths]);
  runGit(root, ["commit", "-qm", message]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

/**
 * 创建一个不是 Git 仓库的临时目录.
 *
 * @returns {{root: string, cleanup: () => void}} 目录与清理函数.
 */
export function createTemporaryDirectory() {
  const root = mkdtempSync(path.join(os.tmpdir(), TEMPORARY_PREFIX));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * 在指定目录运行插件命令.
 *
 * @param {readonly string[]} args 参数.
 * @param {string} cwd 工作目录.
 * @returns {{status: number | null, stdout: string}} 退出码与标准输出.
 */
export function runCommand(args, cwd) {
  const result = spawnSync(process.execPath, [PLUGIN_COMMAND, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout };
}

/**
 * 在临时目录中写一份会话转录; 编排会话的转录带本项目的编排标记.
 *
 * @param {string} root 项目根目录, 用于计算标记.
 * @param {boolean} isOrchestrator 是否写成编排会话的转录.
 * @returns {{path: string, cleanup: () => void}} 转录路径与清理函数.
 */
export function writeTranscript(root, isOrchestrator) {
  const directory = mkdtempSync(path.join(os.tmpdir(), TEMPORARY_PREFIX));
  const file = path.join(directory, "transcript.jsonl");
  const line = isOrchestrator
    ? `- 编排标记: ${orchestratorMarker(root)}`
    : "普通会话";
  writeFileSync(
    file,
    `${JSON.stringify({ type: "user", message: { content: line } })}\n`,
    "utf8",
  );
  return {
    path: file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

/**
 * 在临时仓库中初始化项目并提交初始化产物.
 *
 * @param {string} root 仓库根目录.
 * @returns {{project: (args: readonly string[]) => {status: number | null, stdout: string}, hook: (input: Record<string, unknown>) => {status: number | null, output: any}}} 调用命令行与 hook 的函数.
 * @throws {Error} 初始化失败时.
 */
export function initializeProject(root) {
  const init = runCommand(["init"], root);
  if (!init.stdout.includes("设置结果: 已写入")) {
    throw new Error(`初始化失败: ${init.stdout}`);
  }
  commitPaths(root, [".navigator", ".claude/settings.json"], "navigator init");
  return {
    project: (args) => runCommand(args, root),
    hook: (input) => runHook(input, root),
  };
}

/**
 * 写一份 JSON 草稿.
 *
 * @param {string} root 仓库根目录.
 * @param {string} name 草稿文件名.
 * @param {unknown} value 草稿内容.
 * @returns {string} 草稿的项目相对路径.
 */
export function writeDraft(root, name, value) {
  const relative = `${DRAFTS_DIRECTORY}/${name}`;
  mkdirSync(path.join(root, DRAFTS_DIRECTORY), { recursive: true });
  writeFileSync(path.join(root, relative), JSON.stringify(value), "utf8");
  return relative;
}

/**
 * 初始化项目并走完立项: 写需求文件, 登记项目设置, 写入路线.
 *
 * @param {string} root 仓库根目录.
 * @param {{settings?: unknown, roadmap?: unknown}} [options] 项目设置与路线, 省略时用默认值.
 * @returns {ReturnType<typeof initializeProject>} 调用命令行与 hook 的函数.
 * @throws {Error} 任何一步失败时.
 */
export function startProject(
  root,
  { settings = DEFAULT_SETTINGS, roadmap = DEFAULT_ROADMAP } = {},
) {
  const runner = initializeProject(root);
  writeFileSync(path.join(root, REQUIREMENTS_FILE), "# 需求\n", "utf8");
  for (const [command, draft] of [
    ["setup", settings],
    ["roadmap", roadmap],
  ]) {
    const result = runner.project([
      command,
      "--from",
      writeDraft(root, `${command}.json`, draft),
    ]);
    if (result.status !== 0) {
      throw new Error(`${command} 失败: ${result.stdout}`);
    }
  }
  return runner;
}

/**
 * 替换切片文件中某个小节的内容; 同名小节有多个时替换最后一个.
 *
 * @param {string} root 仓库根目录.
 * @param {string} file 切片文件的项目相对路径.
 * @param {Readonly<Record<string, string>>} sections 小节标题到新内容的映射.
 * @returns {void}
 * @throws {Error} 小节不存在时.
 */
export function fillSections(root, file, sections) {
  const absolute = path.join(root, file);
  const lines = readFileSync(absolute, "utf8").split("\n");
  for (const [title, body] of Object.entries(sections)) {
    const start = lines.lastIndexOf(`### ${title}`);
    if (start < 0) {
      throw new Error(`切片文件中没有小节 ${title}`);
    }
    const next = lines.findIndex(
      (line, index) => index > start && /^#{1,3} /u.test(line),
    );
    lines.splice(
      start + 1,
      (next < 0 ? lines.length : next) - start - 1,
      "",
      ...body.split("\n"),
      "",
    );
  }
  writeFileSync(absolute, lines.join("\n"), "utf8");
}

/**
 * 以标准输入驱动插件的 hook 脚本.
 *
 * @param {Record<string, unknown>} input hook 输入.
 * @param {string} projectRoot 项目根目录, 作为 CLAUDE_PROJECT_DIR 传入.
 * @returns {{status: number | null, output: any}} 退出码与解析后的输出 (无输出时为 undefined).
 */
export function runHook(input, projectRoot) {
  const result = spawnSync(process.execPath, [PLUGIN_HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
  });
  return {
    status: result.status,
    output: result.stdout === "" ? undefined : JSON.parse(result.stdout),
  };
}

/**
 * 在指定目录运行 git, 使用固定的测试身份.
 *
 * @param {string} cwd 工作目录.
 * @param {readonly string[]} args git 参数.
 * @returns {string} 去掉首尾空白的标准输出.
 * @throws {Error} git 退出码非 0 时.
 */
export function runGit(cwd, args) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} 失败: ${result.stderr}`);
  }
  return result.stdout.trim();
}
