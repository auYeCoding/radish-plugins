/**
 * @file 校验插件市场清单及其列出的每个插件.
 *
 * 对市场根目录, 以及每个来源位于本仓库内的插件, 分别执行
 * `claude plugin validate --strict`. 市场级校验只检查清单文件, 因此需要逐个
 * 校验插件目录, 才能覆盖其中的 skills, agents 与 commands. 插件列表以市场
 * 清单为唯一权威来源.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 仓库根目录的绝对路径, 同时也是插件市场的根目录.
 * @type {string}
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * 市场清单相对于仓库根目录的路径.
 * @type {string}
 */
const MARKETPLACE_MANIFEST = path.join(".claude-plugin", "marketplace.json");

/**
 * 指向市场根目录本身的校验目标.
 * @type {string}
 */
const MARKETPLACE_TARGET = ".";

/**
 * 插件来源的路径前缀, 带此前缀表示插件位于本仓库内.
 * @type {string}
 */
const LOCAL_SOURCE_PREFIX = "./";

/**
 * 提供 Claude Code CLI 的 npm 包名.
 * @type {string}
 */
const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code";

/**
 * CLI 可执行文件在该包 `bin` 映射中的键名.
 * @type {string}
 */
const CLAUDE_BIN_NAME = "claude";

/**
 * 位于校验目标之前的 CLI 参数.
 * @type {readonly string[]}
 */
const VALIDATE_COMMAND = ["plugin", "validate", "--strict"];

/**
 * 任一目标校验失败时的进程退出码.
 * @type {number}
 */
const EXIT_FAILURE = 1;

/**
 * 校验所有目标, 任一失败时设置失败退出码.
 *
 * @returns {void}
 */
function main() {
  const claudeExecutable = resolveClaudeExecutable();
  const failedTargets = listValidationTargets().filter(
    (target) => !validateTarget(claudeExecutable, target),
  );
  if (failedTargets.length > 0) {
    console.error(`\nValidation failed for: ${failedTargets.join(", ")}`);
    process.exitCode = EXIT_FAILURE;
  }
}

/**
 * 定位作为开发依赖安装的 Claude Code CLI 可执行文件.
 *
 * 直接启动可执行文件而不经过 npm 生成的 shim, 以便在所有平台上都无需 shell.
 *
 * @returns {string} CLI 可执行文件的绝对路径.
 */
function resolveClaudeExecutable() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve(`${CLAUDE_CODE_PACKAGE}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  return path.join(path.dirname(manifestPath), bin[CLAUDE_BIN_NAME]);
}

/**
 * 列出待校验的路径: 先是市场根目录, 然后是每个来源位于本仓库内的插件.
 *
 * @returns {string[]} 相对于仓库根目录的路径列表.
 */
function listValidationTargets() {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, MARKETPLACE_MANIFEST), "utf8"),
  );
  const localPluginSources = manifest.plugins
    .map((plugin) => plugin.source)
    .filter(
      (source) =>
        typeof source === "string" && source.startsWith(LOCAL_SOURCE_PREFIX),
    );
  return [MARKETPLACE_TARGET, ...localPluginSources];
}

/**
 * 校验单个目标, 并把 CLI 的报告直接输出到控制台.
 *
 * @param {string} claudeExecutable Claude Code CLI 的绝对路径.
 * @param {string} target 待校验路径, 相对于仓库根目录.
 * @returns {boolean} 目标通过校验时返回 true.
 * @throws {Error} 当 CLI 无法启动时.
 */
function validateTarget(claudeExecutable, target) {
  const result = spawnSync(claudeExecutable, [...VALIDATE_COMMAND, target], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Failed to start Claude Code CLI: ${claudeExecutable}`, {
      cause: result.error,
    });
  }
  return result.status === 0;
}

main();
