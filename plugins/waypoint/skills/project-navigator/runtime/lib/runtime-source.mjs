/**
 * @file 运行脚本的来源: 技能目录中的脚本, 还是 init 复制进项目的副本.
 *
 * 初始化, 修复与升级都是把技能目录中的脚本复制进项目, 只能由技能目录中的脚本
 * 完成: 项目副本没有别的来源, 用它运行 init 什么也升级不了. 实例: 编排会话用
 * 副本运行 init, 副本跳过复制却输出 "已升级", 项目一直停在旧版本, 之后发布的
 * 修复都没有生效. 所以副本拒绝运行 init (自检除外), 进入时的下一动作直接写出
 * 完整的命令, 不让编排会话自己拼.
 */

import path from "node:path";

import { BIN_DIRECTORY, SKILL_ROOT, navigatorPath } from "./paths.mjs";

/**
 * 命令行入口相对于技能目录的路径, 以正斜杠分隔.
 * @type {string}
 */
const COMMAND_ENTRY = "runtime/navigator.mjs";

/**
 * 写不出技能目录时使用的占位写法: 项目副本不知道技能目录在哪里.
 * @type {string}
 */
const SKILL_ROOT_PLACEHOLDER = "<技能目录>";

/**
 * 没有会话编号时使用的占位写法.
 * @type {string}
 */
const SESSION_PLACEHOLDER = "<会话编号>";

/**
 * 判断当前运行的脚本是不是项目中的副本.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {boolean} 是项目副本时返回 true.
 */
export function isProjectCopy(projectRoot) {
  return (
    path.resolve(navigatorPath(projectRoot, "bin")) === path.resolve(SKILL_ROOT)
  );
}

/**
 * 写出初始化, 修复或升级项目的完整命令: 由技能目录中的脚本运行 init.
 * 当前运行的是项目副本时, 技能目录用占位写法.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string | undefined} sessionId 要成为编排会话的会话编号; 省略时用占位写法.
 * @returns {string} 命令, 路径以正斜杠分隔并带引号.
 */
export function installCommand(projectRoot, sessionId) {
  const skillRoot = isProjectCopy(projectRoot)
    ? SKILL_ROOT_PLACEHOLDER
    : SKILL_ROOT.split(path.sep).join("/");
  return `node "${skillRoot}/${COMMAND_ENTRY}" init --session "${sessionId ?? SESSION_PLACEHOLDER}"`;
}

/**
 * 写出 "运行 init" 这一步, 供下一动作使用. 技能目录中的脚本写出完整命令;
 * 项目副本写不出技能目录, 改为指向技能内容中的同一条命令.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string | undefined} sessionId 要成为编排会话的会话编号.
 * @returns {string} 例如 `运行 node "<技能目录>/runtime/navigator.mjs" init --session "<编号>" (技能目录中的脚本, 不能换成 .navigator/bin/ 下的副本)`.
 */
export function installStep(projectRoot, sessionId) {
  const source = `技能目录中的脚本, 不能换成 ${BIN_DIRECTORY}/ 下的副本`;
  return isProjectCopy(projectRoot)
    ? `按技能内容 "初始设置" 第 2 步的命令运行 init (${source})`
    : `运行 ${installCommand(projectRoot, sessionId)} (${source})`;
}
