/**
 * @file project-navigator 测试共用的辅助函数: 临时仓库, 调用命令行与 hook.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * 项目内命令行入口, 相对于项目根目录.
 * @type {string}
 */
export const PROJECT_COMMAND = ".navigator/bin/runtime/navigator.mjs";

/**
 * 项目内 hook 入口, 相对于项目根目录.
 * @type {string}
 */
export const PROJECT_HOOK = ".navigator/bin/runtime/hook.mjs";

/**
 * 初始化自检的探测文件, 相对于项目根目录.
 * @type {string}
 */
export const PROBE_FILE = ".navigator/bin/navigator-probe.txt";

/**
 * 临时仓库目录名中使用的前缀, 带空格与中文以覆盖路径处理.
 * @type {string}
 */
const TEMPORARY_PREFIX = "导航 测试-";

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
 * 在指定目录运行命令行脚本.
 *
 * @param {string} command 命令行入口的绝对路径.
 * @param {readonly string[]} args 参数.
 * @param {string} cwd 工作目录.
 * @returns {{status: number | null, stdout: string}} 退出码与标准输出.
 */
export function runCommand(command, args, cwd) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout };
}

/**
 * 从 reply 命令的输出中取出骨架: 跳过前面的填写要求, 从一级标题开始.
 *
 * @param {string} output reply 命令的标准输出.
 * @returns {string} 骨架.
 */
export function replySkeleton(output) {
  return output.slice(output.search(/^# /mu));
}

/**
 * 在临时仓库中完成初始化与自检, 使指定会话成为编排会话.
 *
 * @param {string} root 仓库根目录.
 * @param {string} sessionId 编排会话编号.
 * @returns {{project: (args: readonly string[]) => {status: number | null, stdout: string}, hook: (input: Record<string, unknown>) => {status: number | null, output: any}}} 调用项目内命令行与 hook 的函数.
 * @throws {Error} 自检未通过时.
 */
export function initializeProject(root, sessionId) {
  runCommand(PLUGIN_COMMAND, ["init", "--session", sessionId], root);
  const hook = (input) => runHook(path.join(root, PROJECT_HOOK), input, root);
  hook({
    session_id: sessionId,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(root, PROBE_FILE), content: "x" },
  });
  const project = (args) =>
    runCommand(path.join(root, PROJECT_COMMAND), args, root);
  const verify = project(["init", "--verify"]);
  if (!verify.stdout.includes("通过, 防护已生效")) {
    throw new Error(`自检未通过: ${verify.stdout}`);
  }
  runCommand(PLUGIN_COMMAND, ["enter", "--session", sessionId], root);
  return { project, hook };
}

/**
 * 以标准输入驱动 hook 脚本.
 *
 * @param {string} hookPath hook 入口的绝对路径.
 * @param {Record<string, unknown>} input hook 输入.
 * @param {string} projectRoot 项目根目录, 作为 CLAUDE_PROJECT_DIR 传入.
 * @returns {{status: number | null, output: any}} 退出码与解析后的输出 (无输出时为 undefined).
 */
export function runHook(hookPath, input, projectRoot) {
  const result = spawnSync(process.execPath, [hookPath], {
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
