/**
 * @file 调用 git: 查询本仓库信息, 以及为源码证据访问第三方公开仓库.
 * 只在命令行脚本中使用, hook 的热路径不启动 git.
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
 * 显示用的短提交哈希长度.
 * @type {number}
 */
const SHORT_HASH_LENGTH = 7;

/**
 * 访问第三方仓库时附加的环境变量: 不在终端询问账号, 不弹出凭据管理器的窗口.
 * 需要账号的仓库直接失败, 避免命令卡住.
 * @type {Readonly<Record<string, string>>}
 */
const NON_INTERACTIVE_ENVIRONMENT = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
});

/**
 * 访问第三方仓库时放在最前面的 git 参数: 清空凭据助手, 不读取本机保存的账号.
 * @type {readonly string[]}
 */
const NO_CREDENTIAL_ARGUMENTS = Object.freeze(["-c", "credential.helper="]);

/**
 * @typedef {object} GitOutcome 一次 git 运行的结果.
 * @property {boolean} isSuccess 退出码为 0 时为 true.
 * @property {Buffer} stdout 标准输出的原始字节.
 * @property {string} message 失败原因: git 的错误输出, 或无法启动, 超时的说明; 成功时为空字符串.
 */

/**
 * 截取显示用的短提交哈希.
 *
 * @param {string | null | undefined} commit 完整提交哈希.
 * @returns {string} 短哈希; 没有提交时为 "无".
 */
export function shortHash(commit) {
  return typeof commit === "string" && commit !== ""
    ? commit.slice(0, SHORT_HASH_LENGTH)
    : "无";
}

/**
 * 在指定目录运行 git 并返回标准输出.
 *
 * @param {string} directory 运行目录.
 * @param {readonly string[]} args git 参数.
 * @param {{env?: Record<string, string>, input?: string}} [options] 附加的环境变量与标准输入.
 * @returns {string | undefined} 去掉首尾空白的输出; git 无法启动或退出码非 0 时为 undefined.
 */
export function runGit(directory, args, options = {}) {
  const result = spawnSync(GIT_EXECUTABLE, args, {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
    input: options.input,
    env:
      options.env === undefined
        ? process.env
        : { ...process.env, ...options.env },
  });
  if (result.error !== undefined || result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}

/**
 * 以不读凭据, 不弹提示的方式运行 git, 保留原始输出与失败原因.
 * 用于访问第三方公开仓库; 调用方用 `--git-dir` 指明仓库, 不依赖工作目录.
 *
 * @param {readonly string[]} args git 参数.
 * @param {number} timeout 超时毫秒数.
 * @returns {GitOutcome} 运行结果.
 */
export function runIsolatedGit(args, timeout) {
  const result = spawnSync(
    GIT_EXECUTABLE,
    [...NO_CREDENTIAL_ARGUMENTS, ...args],
    {
      windowsHide: true,
      timeout,
      env: { ...process.env, ...NON_INTERACTIVE_ENVIRONMENT },
    },
  );
  if (result.error !== undefined) {
    return {
      isSuccess: false,
      stdout: Buffer.alloc(0),
      message: `git 无法完成: ${result.error.message}`,
    };
  }
  return {
    isSuccess: result.status === 0,
    stdout: result.stdout,
    message: result.status === 0 ? "" : result.stderr.toString("utf8").trim(),
  };
}

/**
 * 按原始字节读取某个提交中的文件内容.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} objectSpec 对象描述, 例如 "<提交>:<路径>".
 * @returns {Buffer | undefined} 文件内容; 对象不存在时为 undefined.
 */
export function readGitBlob(worktreeRoot, objectSpec) {
  const result = spawnSync(GIT_EXECUTABLE, ["cat-file", "blob", objectSpec], {
    cwd: worktreeRoot,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    return undefined;
  }
  return result.stdout;
}

/**
 * 判断一个提交是否是另一个提交的祖先 (含相同).
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} ancestor 可能的祖先提交.
 * @param {string} descendant 可能的后代提交.
 * @returns {boolean} 是祖先时返回 true; 任一提交不存在时为 false.
 */
export function isAncestor(worktreeRoot, ancestor, descendant) {
  return (
    runGit(worktreeRoot, [
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]) !== undefined
  );
}

/**
 * 列出从 from (不含) 到 to (含) 之间的提交, 从新到旧.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} from 起点提交.
 * @param {string} to 终点提交.
 * @returns {string[]} 提交哈希列表.
 */
export function commitsBetween(worktreeRoot, from, to) {
  const output = runGit(worktreeRoot, ["rev-list", `${from}..${to}`]);
  return output === undefined || output === "" ? [] : output.split("\n");
}

/**
 * 判断提交对象是否存在于本地仓库.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} commit 提交哈希.
 * @returns {boolean} 存在时返回 true.
 */
export function commitExists(worktreeRoot, commit) {
  return (
    runGit(worktreeRoot, ["cat-file", "-e", `${commit}^{commit}`]) !== undefined
  );
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
 * 统计仓库中已跟踪的文件数.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {number} 文件数; 查询失败时为 0.
 */
export function countTrackedFiles(worktreeRoot) {
  const output = runGit(worktreeRoot, ["ls-files", "-z"]);
  if (output === undefined || output === "") {
    return 0;
  }
  return output.split("\0").filter((entry) => entry !== "").length;
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
      "-c",
      "core.quotePath=false",
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
