/**
 * @file 检查运行环境: 是否位于 Git 仓库, Node.js 版本是否满足要求.
 */

import { findRepositoryRoot } from "./repo.mjs";

/**
 * 运行脚本要求的 Node.js 最低主版本.
 * @type {number}
 */
export const MINIMUM_NODE_MAJOR = 22;

/**
 * @typedef {object} EnvironmentReport 环境检查结果.
 * @property {string | undefined} repositoryRoot Git 工作区根目录; 不在仓库中时为 undefined.
 * @property {string} nodeVersion 当前 Node.js 版本, 不带 "v" 前缀.
 * @property {boolean} isNodeSupported Node.js 版本是否满足要求.
 */

/**
 * 检查当前目录的运行环境.
 *
 * @param {string} directory 起始目录, 通常是会话的工作目录.
 * @returns {EnvironmentReport} 检查结果.
 */
export function checkEnvironment(directory) {
  const nodeVersion = process.versions.node;
  return {
    repositoryRoot: findRepositoryRoot(directory),
    nodeVersion,
    isNodeSupported: Number(nodeVersion.split(".")[0]) >= MINIMUM_NODE_MAJOR,
  };
}
