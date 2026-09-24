/**
 * @file 从第三方公开仓库按版本取回某个文件的若干行.
 *
 * 每个仓库在缓存目录中对应一个只有远端配置的裸仓库. 每次只获取深度为 1 的
 * 提交, 文件内容按需下载, 因此只下载被引用的文件. 缓存放在 Git 目录中,
 * 不进入工作区. git 以不读凭据, 不弹提示的方式运行, 需要账号的仓库直接失败.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { runIsolatedGit } from "./repo.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 访问远端 (取版本, 按需取文件) 的超时毫秒数.
 * @type {number}
 */
const REMOTE_TIMEOUT = 120_000;

/**
 * 本地 git 操作 (建缓存仓库, 查配置, 解析提交) 的超时毫秒数.
 * @type {number}
 */
const LOCAL_TIMEOUT = 30_000;

/**
 * 缓存目录名取仓库地址 SHA-256 摘要的前若干位.
 * @type {number}
 */
const CACHE_NAME_LENGTH = 16;

/**
 * 缓存仓库中远端的名称.
 * @type {string}
 */
const REMOTE_NAME = "origin";

/**
 * @typedef {object} LineRange 行号范围, 两端都含.
 * @property {number} start 起始行号, 从 1 开始.
 * @property {number} end 结束行号.
 */

/**
 * @typedef {object} SourceExcerpt 取回的源码片段.
 * @property {string} commit 版本对应的完整提交号.
 * @property {{number: number, text: string}[]} lines 被引用的各行.
 */

/**
 * @typedef {object} SourceResult 取源码的结果: 取到的片段, 或取不到的原因.
 * @property {SourceExcerpt} [excerpt] 取到的源码.
 * @property {string} [problem] 取不到的原因.
 */

/**
 * @typedef {object} VersionResult 解析版本的结果: 对应的完整提交号, 或取不到的原因.
 * @property {string} [commit] 版本对应的完整提交号.
 * @property {string} [problem] 取不到的原因.
 */

/**
 * 从仓库获取某个版本, 返回对应的提交号. 本函数不限制仓库地址的协议,
 * 调用方负责校验.
 *
 * @param {object} options 获取参数.
 * @param {string} options.cacheRoot 源码缓存目录.
 * @param {string} options.repository 仓库地址.
 * @param {string} options.version 版本: tag, 分支或完整提交号.
 * @returns {VersionResult} 提交号, 或取不到的原因.
 * @throws {WorkflowError} 无法建立本地缓存时.
 */
export function fetchVersion({ cacheRoot, repository, version }) {
  const gitDirectory = `--git-dir=${prepareCache(cacheRoot, repository)}`;
  const fetched = runIsolatedGit(
    [
      gitDirectory,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "--filter=blob:none",
      "--no-tags",
      REMOTE_NAME,
      version,
    ],
    REMOTE_TIMEOUT,
  );
  const resolved = fetched.isSuccess
    ? runIsolatedGit([gitDirectory, "rev-parse", "FETCH_HEAD"], LOCAL_TIMEOUT)
    : fetched;
  return resolved.isSuccess
    ? { commit: resolved.stdout.toString("utf8").trim() }
    : { problem: `取不到版本 ${version}: ${resolved.message}` };
}

/**
 * 读取已获取的提交中某个文件的若干行, 文件内容按需下载.
 *
 * @param {object} options 读取参数.
 * @param {string} options.cacheRoot 源码缓存目录.
 * @param {string} options.repository 仓库地址.
 * @param {string} options.commit 由 fetchVersion 得到的提交号.
 * @param {string} options.filePath 仓库中的文件路径.
 * @param {LineRange} options.range 被引用的行.
 * @returns {SourceResult} 取到的源码, 或取不到的原因.
 * @throws {WorkflowError} 无法建立本地缓存时.
 */
export function readSourceLines({
  cacheRoot,
  repository,
  commit,
  filePath,
  range,
}) {
  const gitDirectory = `--git-dir=${prepareCache(cacheRoot, repository)}`;
  const blob = runIsolatedGit(
    [gitDirectory, "cat-file", "blob", `${commit}:${filePath}`],
    REMOTE_TIMEOUT,
  );
  if (!blob.isSuccess) {
    return { problem: `取不到文件 ${filePath}: ${blob.message}` };
  }
  const lines = splitLines(blob.stdout.toString("utf8"));
  if (range.end > lines.length) {
    return {
      problem: `文件 ${filePath} 只有 ${lines.length} 行, 引用的行号 ${range.start}-${range.end} 超出范围.`,
    };
  }
  return {
    excerpt: {
      commit,
      lines: lines
        .slice(range.start - 1, range.end)
        .map((text, index) => ({ number: range.start + index, text })),
    },
  };
}

/**
 * 准备某个仓库的缓存: 已有且远端地址一致时直接使用, 否则重建一个只有远端配置的裸仓库.
 *
 * @param {string} cacheRoot 源码缓存目录.
 * @param {string} repository 仓库地址.
 * @returns {string} 缓存仓库的绝对路径.
 * @throws {WorkflowError} 无法建立缓存仓库时.
 */
function prepareCache(cacheRoot, repository) {
  const directory = path.join(
    cacheRoot,
    createHash("sha256")
      .update(repository)
      .digest("hex")
      .slice(0, CACHE_NAME_LENGTH),
  );
  const gitDirectory = `--git-dir=${directory}`;
  if (existsSync(directory)) {
    const configured = runIsolatedGit(
      [gitDirectory, "config", "--get", `remote.${REMOTE_NAME}.url`],
      LOCAL_TIMEOUT,
    );
    if (
      configured.isSuccess &&
      configured.stdout.toString("utf8").trim() === repository
    ) {
      return directory;
    }
    rmSync(directory, { recursive: true, force: true });
  }
  mkdirSync(cacheRoot, { recursive: true });
  for (const args of [
    ["init", "--quiet", "--bare", directory],
    [gitDirectory, "remote", "add", REMOTE_NAME, repository],
  ]) {
    const outcome = runIsolatedGit(args, LOCAL_TIMEOUT);
    if (!outcome.isSuccess) {
      rmSync(directory, { recursive: true, force: true });
      throw new WorkflowError(`无法建立源码缓存: ${outcome.message}`);
    }
  }
  return directory;
}

/**
 * 把文件内容拆成行; 文件末尾的换行不算作多出的一行.
 *
 * @param {string} text 文件内容.
 * @returns {string[]} 各行.
 */
function splitLines(text) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}
