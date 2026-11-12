/**
 * @file 插件命令名到处理函数的映射.
 */

import { runBrief } from "./brief.mjs";
import { runCheck } from "./check.mjs";
import { runDecision } from "./decision.mjs";
import { runEnter } from "./enter.mjs";
import { runInit } from "./init.mjs";
import { runPlan } from "./plan.mjs";
import { runRef } from "./ref.mjs";
import { runSetup } from "./setup.mjs";
import { runSlice } from "./slice.mjs";
import { runUninstall } from "./uninstall.mjs";

/**
 * @typedef {object} CommandInvocation 一次命令调用的参数.
 * @property {string} command 命令名.
 * @property {string[]} positionals 命令名之后的位置参数.
 * @property {Record<string, any>} values 选项值.
 * @property {string} cwd 会话工作目录.
 * @property {string} now 当前时间, ISO 格式.
 */

/**
 * @typedef {(invocation: CommandInvocation) => string[]} CommandHandler 命令的处理函数, 返回输出各行.
 */

/**
 * 技能加载时调用的命令; 它出错时也以退出码 0 结束.
 * @type {string}
 */
export const ENTER_COMMAND = "enter";

/**
 * 每条命令的处理函数, 键为命令名.
 * @type {Readonly<Record<string, CommandHandler>>}
 */
export const COMMAND_HANDLERS = Object.freeze({
  init: runInit,
  uninstall: runUninstall,
  [ENTER_COMMAND]: ({ cwd }) => runEnter({ cwd, isEntry: true }),
  status: ({ cwd }) => runEnter({ cwd, isEntry: false }),
  ref: runRef,
  setup: runSetup,
  roadmap: runPlan,
  milestone: runPlan,
  finish: runPlan,
  slice: runSlice,
  brief: runBrief,
  decision: runDecision,
  check: runCheck,
});
