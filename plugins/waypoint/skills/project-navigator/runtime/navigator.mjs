/**
 * @file project-navigator 的命令行入口, 由插件 `bin/` 中的 `project-navigator`
 * 调用; 技能加载时的 enter 直接用 node 运行本文件.
 *
 * 用法: project-navigator <命令> [参数]
 *
 * 命令:
 * - 初始化与进入: init, uninstall, enter, status
 * - 骨架与参考: reply <回复类型> [--option <组号>], template <文件种类> [--option <结构编号>], ref <名称>
 * - 阶段: stage <阶段编号>, step <步骤标识>, skip <阶段编号> --from <草稿>, finish
 * - 推进路线: roadmap --from <草稿>, milestone <编号> <状态>, slice <编号> <状态>
 * - 工单: order new|set, exec-brief, review-brief, research-brief
 * - 源码证据: evidence, evidence check <仓库> <版本> <路径> <行号>
 * - 记录: risk, decision, change
 * - 体检与规范: check [文件...], standards --from <草稿>, codecheck set --from <草稿>
 * - 问题报告: report [--from <草稿>]
 *
 * enter 由技能加载时的 `!` 命令调用, 任何情况下都以退出码 0 结束, 错误写进输出,
 * 否则 Claude Code 会中止整个技能调用. 其余命令出错时以退出码 1 结束.
 */

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { COMMAND_HANDLERS } from "./commands/handlers.mjs";
import {
  EVENT_KINDS,
  REPORT_STEP,
  isInternalError,
  isRecommendedCommand,
  readGuidance,
  recordEvent,
  stackLines,
} from "./lib/diagnostics.mjs";
import { findWorktreeRoot, navigatorPath } from "./lib/paths.mjs";

/**
 * 命令出错时的退出码.
 * @type {number}
 */
const EXIT_FAILURE = 1;

/**
 * 出错时也以退出码 0 结束的命令.
 * @type {string}
 */
const ENTER_COMMAND = "enter";

/**
 * 命令行选项的定义.
 * @type {import("node:util").ParseArgsConfig["options"]}
 */
const OPTIONS = {
  option: { type: "string", default: "1" },
  kind: { type: "string" },
  slug: { type: "string" },
  slice: { type: "string" },
  from: { type: "string" },
  by: { type: "string" },
  "accept-unverified": { type: "boolean", default: false },
};

/**
 * 解析参数, 执行命令并输出结果.
 *
 * @returns {void}
 */
function main() {
  const isEnter = process.argv[2] === ENTER_COMMAND;
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: OPTIONS,
      allowPositionals: true,
    });
    const [command, ...rest] = positionals;
    printLines(
      dispatch({
        command,
        positionals: rest,
        values,
        cwd: process.cwd(),
        now: new Date().toISOString(),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printLines([
      `- 脚本错误: ${message}`,
      ...diagnoseFailure(error, process.argv.slice(2)),
    ]);
    if (!isEnter) {
      process.exitCode = EXIT_FAILURE;
    }
  }
}

/**
 * 判断一次命令失败是不是技能本身的问题, 是的话记下异常并给出上报的做法.
 * 两种情况算技能问题: 脚本内部错误; 上一次 "下一动作" 要求运行的命令被拒绝.
 * 记录本身出错时不影响命令的输出.
 *
 * @param {unknown} error 捕获到的错误.
 * @param {readonly string[]} args 命令行参数.
 * @returns {string[]} 追加在错误之后的输出行; 不是技能问题时为空.
 */
function diagnoseFailure(error, args) {
  try {
    const projectRoot = findWorktreeRoot(process.cwd());
    if (
      projectRoot === undefined ||
      !existsSync(navigatorPath(projectRoot, "state"))
    ) {
      return [];
    }
    const commandLine = args.filter((arg) => !arg.startsWith("-")).join(" ");
    const isInternal = isInternalError(error);
    if (
      !isInternal &&
      !isRecommendedCommand(readGuidance(projectRoot), commandLine)
    ) {
      return [];
    }
    recordEvent(projectRoot, {
      kind: isInternal ? EVENT_KINDS.internalError : EVENT_KINDS.refused,
      source: commandLine,
      message: error instanceof Error ? error.message : String(error),
      stack: isInternal ? stackLines(error) : [],
      at: new Date().toISOString(),
    });
    return [
      isInternal
        ? `- 技能异常: 这是技能脚本的内部错误, 不是操作问题. ${REPORT_STEP}`
        : `- 技能异常: 这条命令是上一次 "下一动作" 要求运行的, 却被拒绝. 按拒绝理由能继续时照做; ${REPORT_STEP}`,
    ];
  } catch {
    return [];
  }
}

/**
 * 按命令名调用对应的处理函数.
 *
 * @param {Omit<import("./commands/handlers.mjs").CommandInvocation, "command"> & {command: string | undefined}} invocation 命令调用.
 * @returns {string[]} 输出各行.
 * @throws {Error} 命令名未知时.
 */
function dispatch(invocation) {
  const { command } = invocation;
  if (command === undefined || !Object.hasOwn(COMMAND_HANDLERS, command)) {
    throw new Error(
      `navigator: 未知命令 "${command ?? ""}", 可用命令: ${Object.keys(COMMAND_HANDLERS).join(", ")}`,
    );
  }
  return COMMAND_HANDLERS[command]({ ...invocation, command });
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
