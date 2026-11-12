/**
 * @file 调用 git 查询本仓库的信息. 只在命令行脚本中使用, hook 不启动 git.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { gitCommonDirectory } from "./paths.mjs";

/**
 * git 可执行文件名; 通过 PATH 查找, 不经过 shell.
 * @type {string}
 */
const GIT_EXECUTABLE = "git";

/**
 * 让 git 原样输出非 ASCII 路径的参数.
 * @type {readonly string[]}
 */
const PLAIN_PATH_ARGUMENTS = Object.freeze(["-c", "core.quotePath=false"]);

/**
 * 在指定目录运行 git 并返回标准输出.
 *
 * @param {string} directory 运行目录.
 * @param {readonly string[]} args git 参数.
 * @returns {string | undefined} 去掉首尾空白的输出; git 无法启动或退出码非 0 时为 undefined.
 */
export function runGit(directory, args) {
  const result = spawnSync(GIT_EXECUTABLE, args, {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}

/**
 * 查找目录所在 Git 工作区的根目录.
 *
 * @param {string} directory 起始目录.
 * @returns {string | undefined} 工作区根目录; 不在 Git 仓库中时为 undefined.
 */
export function findRepositoryRoot(directory) {
  return runGit(directory, ["rev-parse", "--show-toplevel"]);
}

/**
 * 列出仓库中已跟踪的文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string[]} 以正斜杠分隔的项目相对路径; 查询失败时为空.
 */
export function listTrackedFiles(worktreeRoot) {
  return splitLines(
    runGit(worktreeRoot, [...PLAIN_PATH_ARGUMENTS, "ls-files"]),
  );
}

/**
 * 列出相对某个提交新增的文件: 已提交或已暂存的新文件, 以及未跟踪但没有被忽略
 * 的文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} baseCommit 作为基准的提交.
 * @returns {string[]} 以正斜杠分隔的项目相对路径.
 */
export function listAddedFiles(worktreeRoot, baseCommit) {
  return [
    ...splitLines(
      runGit(worktreeRoot, [
        ...PLAIN_PATH_ARGUMENTS,
        "diff",
        "--name-only",
        "--diff-filter=A",
        baseCommit,
      ]),
    ),
    ...splitLines(
      runGit(worktreeRoot, [
        ...PLAIN_PATH_ARGUMENTS,
        "ls-files",
        "--others",
        "--exclude-standard",
      ]),
    ),
  ];
}

/**
 * 把 git 的多行输出拆成非空行.
 *
 * @param {string | undefined} output git 的输出; 命令失败时为 undefined.
 * @returns {string[]} 各行.
 */
function splitLines(output) {
  return (output ?? "").split("\n").filter((line) => line !== "");
}

/**
 * @typedef {object} IgnoredPath 一条会被 Git 忽略的路径.
 * @property {string} path 以正斜杠分隔的项目相对路径.
 * @property {string} rule 生效的忽略规则: 规则所在文件, 行号与规则原文.
 */

/**
 * `git check-ignore --verbose` 的输出行: 规则文件, 行号, 规则原文, 制表符, 路径.
 * 规则文件可能是带盘符的绝对路径, 所以从行号处切分.
 * @type {RegExp}
 */
const CHECK_IGNORE_LINE_PATTERN = /^(.*):(\d+):(.*)\t(.*)$/u;

/**
 * `git check-ignore` 在没有任何路径被忽略时的退出码.
 * @type {number}
 */
const CHECK_IGNORE_NONE_STATUS = 1;

/**
 * 按忽略规则 (不看是否已跟踪) 找出会被 Git 忽略的路径. 最后生效的是
 * 取反规则 (以 "!" 开头) 的路径不算被忽略.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {readonly string[]} relativePaths 以正斜杠分隔的项目相对路径.
 * @returns {IgnoredPath[]} 会被忽略的路径及其规则.
 * @throws {Error} git 无法运行时.
 */
export function findIgnoredPaths(worktreeRoot, relativePaths) {
  if (relativePaths.length === 0) {
    return [];
  }
  const result = spawnSync(
    GIT_EXECUTABLE,
    [
      ...PLAIN_PATH_ARGUMENTS,
      "check-ignore",
      "--no-index",
      "--verbose",
      "--stdin",
    ],
    {
      cwd: worktreeRoot,
      input: `${relativePaths.join("\n")}\n`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (
    result.error !== undefined ||
    (result.status !== 0 && result.status !== CHECK_IGNORE_NONE_STATUS)
  ) {
    throw new Error(
      `repo: git check-ignore 失败: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => CHECK_IGNORE_LINE_PATTERN.exec(line))
    .filter((match) => match !== null && !match[3].startsWith("!"))
    .map((match) => ({
      path: match[4],
      rule: `${match[1]}:${match[2]}: ${match[3]}`,
    }));
}

/**
 * 按忽略规则分组描述被忽略的路径: 每条规则写明影响的路径数与一个例子.
 *
 * @param {readonly IgnoredPath[]} ignored 被忽略的路径.
 * @returns {string[]} 每条规则一句描述.
 */
export function summarizeIgnoredPaths(ignored) {
  return [...Map.groupBy(ignored, (entry) => entry.rule)].map(
    ([rule, entries]) =>
      `${rule}, 影响 ${entries.length} 个路径, 例如 ${entries[0].path}`,
  );
}

/**
 * `git status --porcelain -z` 每条记录中状态码与路径之间的字符数: 两位状态码与一个空格.
 * @type {number}
 */
const STATUS_CODE_WIDTH = 3;

/**
 * 重命名或复制记录的状态码首字母; 这类记录后面多跟一段原路径.
 * @type {readonly string[]}
 */
const PAIRED_STATUS_CODES = Object.freeze(["R", "C"]);

/**
 * 列出指定范围内相对 HEAD 尚未入库的路径: 已改动, 已暂存未提交, 以及未跟踪但
 * 没有被忽略的文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {readonly string[]} pathspecs 检查范围, 项目相对路径.
 * @returns {string[]} 以正斜杠分隔的项目相对路径.
 * @throws {Error} git 无法运行时.
 */
export function listUncommittedPaths(worktreeRoot, pathspecs) {
  const result = spawnSync(
    GIT_EXECUTABLE,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...pathspecs,
    ],
    { cwd: worktreeRoot, encoding: "utf8", windowsHide: true },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `repo: git status 失败: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  const entries = result.stdout.split("\0").filter((entry) => entry !== "");
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    paths.push(entries[index].slice(STATUS_CODE_WIDTH));
    if (PAIRED_STATUS_CODES.includes(entries[index][0])) {
      index += 1;
    }
  }
  return paths;
}

/**
 * 确保某个路径被 Git 忽略. 已被忽略时不做任何事; 否则把它写进仓库的
 * `info/exclude`, 这个文件只在本机生效, 不改动用户的 `.gitignore`.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} relativePath 以正斜杠分隔的项目相对路径.
 * @returns {boolean} 本次新写入了排除规则时返回 true.
 */
export function ensureLocallyIgnored(worktreeRoot, relativePath) {
  const check = spawnSync(
    GIT_EXECUTABLE,
    ["check-ignore", "-q", relativePath],
    {
      cwd: worktreeRoot,
      windowsHide: true,
    },
  );
  if (check.status === 0) {
    return false;
  }
  const excludeFile = path.join(
    gitCommonDirectory(worktreeRoot),
    "info",
    "exclude",
  );
  const existing = existsSync(excludeFile)
    ? readFileSync(excludeFile, "utf8")
    : "";
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  mkdirSync(path.dirname(excludeFile), { recursive: true });
  appendFileSync(excludeFile, `${separator}/${relativePath}\n`, "utf8");
  return true;
}

/**
 * 查询当前 HEAD 提交.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string | undefined} 完整提交哈希; 仓库尚无提交时为 undefined.
 */
export function headCommit(worktreeRoot) {
  return runGit(worktreeRoot, ["rev-parse", "-q", "--verify", "HEAD"]);
}
