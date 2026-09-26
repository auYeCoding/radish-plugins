/**
 * @file 对账: 比较记录中的最近提交, 当前 HEAD 与状态目录的最近快照.
 *
 * 规则: 导航提交中入库的 `lastCommit` 等于它的父提交, 所以对账能认出自己的提交.
 * 结果分为: 一致, 自己的提交 (可自动纳入), 陌生提交, 回退, squash 合并,
 * 分叉, 状态目录与快照不符.
 */

import { NAVIGATOR_DIRECTORY, STATE_FILE } from "./paths.mjs";
import {
  commitExists,
  commitsBetween,
  headCommit,
  isAncestor,
  readGitBlob,
  runGit,
} from "./repo.mjs";
import { changedSinceLatestSnapshot } from "./snapshots.mjs";

/**
 * 对账结果中显示用的中文.
 * @type {Readonly<Record<string, string>>}
 */
export const RECONCILE_LABELS = Object.freeze({
  consistent: "一致",
  own: "发现自己的提交",
  foreign: "陌生提交",
  rollback: "发生回退",
  squash: "squash 合并",
  diverged: "历史分叉",
  mismatch: "状态目录与快照不符",
  none: "仓库尚无提交",
});

/**
 * @typedef {object} ReconcileResult 对账结果.
 * @property {keyof typeof RECONCILE_LABELS} kind 结果类别.
 * @property {string | null} recorded 记录中的最近提交.
 * @property {string | undefined} head 当前 HEAD.
 * @property {string[]} commits 相关的提交: 陌生提交, 回退丢失的提交, 或自己的提交.
 * @property {string[]} files 与最近快照相比改动过的记录文件, 只在状态目录与快照不符时填写.
 */

/**
 * 提交历史比较之后, 还要比较状态目录与最近快照的结果: 历史一致, 仓库尚无提交,
 * 以及发现自己的提交. 自己的提交会被自动纳入, 纳入之前必须确认状态目录没有被
 * 回退或手工改动; 例如 `git reset --hard` 回到自己的提交, 丢掉未入库的记录时,
 * 提交历史看起来正常, 只有快照能发现记录被回退.
 * @type {readonly string[]}
 */
const SNAPSHOT_CHECKED_KINDS = Object.freeze(["consistent", "none", "own"]);

/**
 * 对账: 先比较提交历史; 历史一致或只有自己的提交时, 再比较状态目录与最近的快照.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {ReconcileResult} 对账结果.
 */
export function reconcile(worktreeRoot, state) {
  const head = headCommit(worktreeRoot);
  const result = compareHistory(worktreeRoot, state.lastCommit, head);
  if (!SNAPSHOT_CHECKED_KINDS.includes(result.kind)) {
    return result;
  }
  const files = changedSinceLatestSnapshot(worktreeRoot) ?? [];
  return files.length > 0 ? { ...result, kind: "mismatch", files } : result;
}

/**
 * 比较记录中的最近提交与当前 HEAD.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string | null} recorded 记录中的最近提交.
 * @param {string | undefined} head 当前 HEAD.
 * @returns {ReconcileResult} 对账结果.
 */
function compareHistory(worktreeRoot, recorded, head) {
  const base = { recorded, head, commits: [], files: [] };
  if (head === undefined) {
    return { ...base, kind: "none" };
  }
  if (recorded === null) {
    return { ...base, kind: "foreign", commits: [head] };
  }
  if (recorded === head) {
    return { ...base, kind: "consistent" };
  }
  if (!commitExists(worktreeRoot, recorded)) {
    return {
      ...base,
      kind: sameNavigatorTree(worktreeRoot, head, recorded)
        ? "squash"
        : "diverged",
    };
  }
  if (isAncestor(worktreeRoot, recorded, head)) {
    const commits = commitsBetween(worktreeRoot, recorded, head);
    const isOwn =
      commits.length === 1 &&
      isNavigatorCommit(worktreeRoot, commits[0], recorded);
    return { ...base, kind: isOwn ? "own" : "foreign", commits };
  }
  if (isAncestor(worktreeRoot, head, recorded)) {
    return {
      ...base,
      kind: "rollback",
      commits: commitsBetween(worktreeRoot, head, recorded),
    };
  }
  return {
    ...base,
    kind: sameNavigatorTree(worktreeRoot, head, recorded)
      ? "squash"
      : "diverged",
  };
}

/**
 * 判断一个提交是否是导航提交: 其中入库的 `lastCommit` 等于它的父提交.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} commit 待判断的提交.
 * @param {string} parent 它的父提交.
 * @returns {boolean} 是导航提交时返回 true.
 */
function isNavigatorCommit(worktreeRoot, commit, parent) {
  const blob = readGitBlob(worktreeRoot, `${commit}:${STATE_FILE}`);
  if (blob === undefined) {
    return false;
  }
  try {
    return JSON.parse(blob.toString("utf8")).lastCommit === parent;
  } catch {
    return false;
  }
}

/**
 * 判断两个提交中的状态目录内容是否完全相同, 用于识别 squash 合并.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} first 第一个提交.
 * @param {string} second 第二个提交; 本地不存在时比较失败.
 * @returns {boolean} 相同时返回 true.
 */
function sameNavigatorTree(worktreeRoot, first, second) {
  const firstTree = runGit(worktreeRoot, [
    "rev-parse",
    "-q",
    "--verify",
    `${first}:${NAVIGATOR_DIRECTORY}`,
  ]);
  const secondTree = runGit(worktreeRoot, [
    "rev-parse",
    "-q",
    "--verify",
    `${second}:${NAVIGATOR_DIRECTORY}`,
  ]);
  return firstTree !== undefined && firstTree === secondTree;
}
