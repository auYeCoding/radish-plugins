/**
 * @file project-navigator 的命令行入口.
 *
 * 用法: node navigator.mjs <命令> [参数]
 *
 * 命令:
 * - 初始化与进入: init [--session <编号>] [--verify], uninstall, enter --session <编号>, status
 * - 骨架: reply <回复类型> [--option <组号>], template <文件种类> [--option <结构编号>]
 * - 阶段: stage <阶段编号>, step <步骤标识>, skip <阶段编号> --from <草稿>
 * - 推进路线: roadmap --from <草稿>, milestone <编号> <状态>, slice <编号> <状态>
 * - 工单: order new|set|tests, review-brief, research-brief
 * - 源码证据: evidence, evidence check <仓库> <版本> <路径> <行号>
 * - 记录: risk, decision, change
 * - 对账: snapshots, restore <提交>, adopt
 * - 体检与规范: check [文件...], standards --from <草稿>, codecheck set --from <草稿>
 * - 取证工具: tools set --from <草稿>
 *
 * enter 由技能加载时的 `!` 命令调用, 任何情况下都以退出码 0 结束, 错误写进输出,
 * 否则 Claude Code 会中止整个技能调用. 其余命令出错时以退出码 1 结束.
 */

import { parseArgs } from "node:util";

import { runBrief } from "./commands/brief.mjs";
import { runCheck } from "./commands/check.mjs";
import { runCodeCheck } from "./commands/codecheck.mjs";
import { runEnter } from "./commands/enter.mjs";
import { runEvidence } from "./commands/evidence.mjs";
import { runInit } from "./commands/init.mjs";
import { runOrder } from "./commands/order.mjs";
import { runPlan } from "./commands/plan.mjs";
import { runRecords } from "./commands/records.mjs";
import { runReply } from "./commands/reply.mjs";
import { runSnapshot } from "./commands/snapshot.mjs";
import { runStage } from "./commands/stage.mjs";
import { runStandards } from "./commands/standards.mjs";
import { runTemplate } from "./commands/template.mjs";
import { runTools } from "./commands/tools.mjs";
import { runUninstall } from "./commands/uninstall.mjs";
import { EVIDENCE_COMMAND_NAME } from "./lib/source-evidence.mjs";

/**
 * 命令出错时的退出码.
 * @type {number}
 */
const EXIT_FAILURE = 1;

/**
 * 命令行选项的定义.
 * @type {import("node:util").ParseArgsConfig["options"]}
 */
const OPTIONS = {
  session: { type: "string" },
  verify: { type: "boolean", default: false },
  option: { type: "string", default: "1" },
  kind: { type: "string" },
  slug: { type: "string" },
  slice: { type: "string" },
  from: { type: "string" },
  by: { type: "string" },
};

/**
 * 只需要位置参数, 选项与运行上下文的命令, 及其处理函数.
 * @type {Readonly<Record<string, (options: {command: string, positionals: string[], values: Record<string, any>, cwd: string, now: string}) => string[]>>}
 */
const WORKFLOW_COMMANDS = Object.freeze({
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
  template: runTemplate,
});

/**
 * 解析参数, 执行命令并输出结果.
 *
 * @returns {void}
 */
function main() {
  const isEnter = process.argv[2] === "enter";
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: OPTIONS,
      allowPositionals: true,
    });
    const [command, ...rest] = positionals;
    const context = { cwd: process.cwd(), now: new Date().toISOString() };
    printLines(dispatch(command, rest, values, context));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printLines([`- 脚本错误: ${message}`]);
    if (!isEnter) {
      process.exitCode = EXIT_FAILURE;
    }
  }
}

/**
 * 按命令名调用对应的命令.
 *
 * @param {string | undefined} command 命令名.
 * @param {string[]} rest 命令名之后的位置参数.
 * @param {Record<string, string | boolean | undefined>} values 选项值.
 * @param {{cwd: string, now: string}} context 运行上下文.
 * @returns {string[]} 输出各行.
 * @throws {Error} 命令名未知时.
 */
function dispatch(command, rest, values, context) {
  const sessionId =
    typeof values.session === "string" && values.session !== ""
      ? values.session
      : undefined;
  switch (command) {
    case "init":
      return runInit({
        ...context,
        sessionId,
        isVerify: values.verify === true,
      });
    case "uninstall":
      return runUninstall(context);
    case "enter":
      return runEnter({ ...context, sessionId, shouldClaim: true });
    case "status":
      return runEnter({ ...context, sessionId, shouldClaim: false });
    case "reply":
      return runReply({
        cwd: context.cwd,
        type: rest[0],
        optionSet: Number(values.option),
      });
    default:
      if (command !== undefined && Object.hasOwn(WORKFLOW_COMMANDS, command)) {
        return WORKFLOW_COMMANDS[command]({
          ...context,
          command,
          positionals: rest,
          values,
        });
      }
      throw new Error(`navigator: 未知命令 "${command ?? ""}"`);
  }
}

/**
 * 逐行输出.
 *
 * @param {string[]} lines 输出各行.
 * @returns {void}
 */
function printLines(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
