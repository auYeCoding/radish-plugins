/**
 * @file project-navigator 的命令行入口, 由插件 `bin/` 中的 `project-navigator`
 * 调用; 技能加载时的 enter 直接用 node 运行本文件.
 *
 * 用法: project-navigator <命令> [参数]
 *
 * 命令:
 * - 初始化与进入: init [--archive], uninstall, enter, status
 * - 参考: ref <名称>
 * - 立项: setup [--from <草稿>], roadmap --from <草稿>
 * - 切片: slice plan <编号> --slug <短名>, slice start [--decided], slice replan,
 *   slice review, slice accept [--accept-unverified], slice redo, slice drop
 * - 委派提示词: brief exec, brief review
 * - 里程与收尾: milestone done <编号>, finish
 * - 记录: decision add --from <草稿>, check [--filters]
 *
 * enter 由技能加载时的 `!` 命令调用, 任何情况下都以退出码 0 结束, 错误写进输出,
 * 否则 Claude Code 会中止整个技能调用. 其余命令出错时以退出码 1 结束.
 */

import { parseArgs } from "node:util";

import { COMMAND_HANDLERS, ENTER_COMMAND } from "./commands/handlers.mjs";

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
  from: { type: "string" },
  slug: { type: "string" },
  archive: { type: "boolean", default: false },
  decided: { type: "boolean", default: false },
  filters: { type: "boolean", default: false },
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
    printLines([
      `- 脚本错误: ${error instanceof Error ? error.message : String(error)}`,
    ]);
    if (!isEnter) {
      process.exitCode = EXIT_FAILURE;
    }
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
