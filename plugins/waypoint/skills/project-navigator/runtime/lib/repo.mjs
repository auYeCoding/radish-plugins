/**
 * @file 调用 git 查询仓库信息. 只在命令行脚本中使用, hook 的热路径不启动 git.
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
