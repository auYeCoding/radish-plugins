/**
 * @file 插件命令名到处理函数的映射. 命令名与 `lib/command-access.mjs` 中的
 * 访问级别表一一对应, 由测试核对两边一致.
 */

import { EVIDENCE_COMMAND_NAME } from "../lib/command-access.mjs";
import { runBrief } from "./brief.mjs";
import { runCheck } from "./check.mjs";
import { runCodeCheck } from "./codecheck.mjs";
import { runEnter } from "./enter.mjs";
import { runEvidence } from "./evidence.mjs";
import { runInit } from "./init.mjs";
import { runOrder } from "./order.mjs";
import { runPlan } from "./plan.mjs";
import { runRecords } from "./records.mjs";
import { runReply } from "./reply.mjs";
import { runSnapshot } from "./snapshot.mjs";
import { runStage } from "./stage.mjs";
import { runStandards } from "./standards.mjs";
import { runTemplate } from "./template.mjs";
import { runTools } from "./tools.mjs";
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
 * 取出 `--session` 选项的值; 未提供或为空时为 undefined.
 *
 * @param {Record<string, any>} values 选项值.
 * @returns {string | undefined} 会话编号.
 */
function sessionOption(values) {
  return typeof values.session === "string" && values.session !== ""
    ? values.session
    : undefined;
}

/**
 * 每条命令的处理函数, 键为命令名.
 * @type {Readonly<Record<string, CommandHandler>>}
 */
export const COMMAND_HANDLERS = Object.freeze({
  init: ({ values, cwd, now }) =>
    runInit({
      cwd,
      now,
      sessionId: sessionOption(values),
      isVerify: values.verify === true,
    }),
  uninstall: ({ cwd, now }) => runUninstall({ cwd, now }),
  enter: ({ values, cwd, now }) =>
    runEnter({ cwd, now, sessionId: sessionOption(values), shouldClaim: true }),
  status: ({ values, cwd, now }) =>
    runEnter({
      cwd,
      now,
      sessionId: sessionOption(values),
      shouldClaim: false,
    }),
  reply: ({ positionals, values, cwd }) =>
    runReply({ cwd, type: positionals[0], optionSet: Number(values.option) }),
  template: runTemplate,
  stage: runStage,
  step: runStage,
  skip: runStage,
  roadmap: runPlan,
  milestone: runPlan,
  slice: runPlan,
  order: runOrder,
  risk: runRecords,
  decision: runRecords,
  change: runRecords,
  "review-brief": runBrief,
  "research-brief": runBrief,
  [EVIDENCE_COMMAND_NAME]: runEvidence,
  snapshots: runSnapshot,
  restore: runSnapshot,
  adopt: runSnapshot,
  check: runCheck,
  standards: runStandards,
  codecheck: runCodeCheck,
  tools: runTools,
});
