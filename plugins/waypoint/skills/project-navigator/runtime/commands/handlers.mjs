/**
 * @file 插件命令名到处理函数的映射.
 */

import { runBrief } from "./brief.mjs";
import { runCheck } from "./check.mjs";
import { runCodeCheck } from "./codecheck.mjs";
import { runEnter } from "./enter.mjs";
import { runEvidence } from "./evidence.mjs";
import { runInit } from "./init.mjs";
import { runOrder } from "./order.mjs";
import { runPlan } from "./plan.mjs";
import { runRecords } from "./records.mjs";
import { runRef } from "./ref.mjs";
import { runReply } from "./reply.mjs";
import { runReport } from "./report.mjs";
import { runStage } from "./stage.mjs";
import { runStandards } from "./standards.mjs";
import { runTemplate } from "./template.mjs";
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
 * 每条命令的处理函数, 键为命令名.
 * @type {Readonly<Record<string, CommandHandler>>}
 */
export const COMMAND_HANDLERS = Object.freeze({
  init: ({ cwd, now }) => runInit({ cwd, now }),
  uninstall: ({ cwd, now }) => runUninstall({ cwd, now }),
  enter: ({ cwd, now }) => runEnter({ cwd, isEntry: true, now }),
  status: ({ cwd, now }) => runEnter({ cwd, isEntry: false, now }),
  reply: ({ positionals, values, cwd }) =>
    runReply({ cwd, type: positionals[0], optionSet: Number(values.option) }),
  template: runTemplate,
  ref: runRef,
  stage: runStage,
  step: runStage,
  skip: runStage,
  finish: runStage,
  roadmap: runPlan,
  milestone: runPlan,
  slice: runPlan,
  order: runOrder,
  risk: runRecords,
  decision: runRecords,
  change: runRecords,
  "exec-brief": runBrief,
  "review-brief": runBrief,
  "research-brief": runBrief,
  evidence: runEvidence,
  check: runCheck,
  standards: runStandards,
  codecheck: runCodeCheck,
  report: runReport,
});
