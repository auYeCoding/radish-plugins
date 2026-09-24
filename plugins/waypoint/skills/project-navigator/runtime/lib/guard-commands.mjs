/**
 * @file 命令行守卫: 编排会话的命令白名单, 以及执行会话与其它会话的命令禁令.
 *
 * 编排会话只允许三类命令: 插件自带的命令行脚本, 只读的 git 命令, 用户已授权的
 * 测试命令; 到了提交步骤, 再放行提交所需的 git 命令. 验收子代理另外可以运行
 * 核对源码证据的插件命令. 含有管道, 重定向, 命令串联等 shell 元字符的命令
 * 一律视为复合命令, 除非与已授权的测试命令逐字相同.
 */

import { EVIDENCE_COMMAND_NAME } from "./source-evidence.mjs";

/**
 * 表示复合命令的 shell 元字符: 分号, 与, 或, 管道, 重定向, 命令替换, 换行.
 * @type {RegExp}
 */
const COMPOUND_PATTERN = /[;&|<>`\n\r]|\$\(/u;

/**
 * 插件命令行脚本的调用形式: node 加上以 runtime/navigator.mjs 结尾的路径.
 * @type {RegExp}
 */
const NAVIGATOR_COMMAND_PATTERN =
  /^node\s+(?:"[^"]*[\\/]runtime[\\/]navigator\.mjs"|[^"\s]*[\\/]runtime[\\/]navigator\.mjs)(\s|$)/u;

/**
 * 只读的 git 子命令.
 * @type {readonly string[]}
 */
const READ_ONLY_GIT_SUBCOMMANDS = Object.freeze([
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
  "describe",
  "cat-file",
  "merge-base",
  "shortlog",
  "grep",
  "check-ignore",
  "for-each-ref",
  "rev-list",
]);

/**
 * git branch 与 git remote 中只做查询的参数.
 * @type {readonly string[]}
 */
const LISTING_ARGUMENTS = Object.freeze([
  "-a",
  "-r",
  "-v",
  "-vv",
  "--list",
  "--show-current",
  "--all",
]);

/**
 * 提交步骤中禁止的 git 参数: 跳过 hook, 修改上一次提交, 强制推送.
 * @type {RegExp}
 */
const FORBIDDEN_COMMIT_FLAGS =
  /\s(--no-verify|--amend|--force|-f|--force-with-lease)(\s|=|$)/u;

/**
 * 一条命令中出现提交或推送的形式, 允许 git 与子命令之间夹带全局参数.
 * @type {RegExp}
 */
const COMMIT_OR_PUSH_PATTERN =
  /\bgit(\s+-[^\s]+(\s+[^-\s][^\s]*)?)*\s+(commit|push)\b/u;

/**
 * 会改写文件的命令特征, 用于粗查是否试图用命令行改写受保护的路径.
 * @type {RegExp}
 */
const WRITE_OPERATION_PATTERN =
  /(>|\btee\b|\brm\b|\bmv\b|\bcp\b|\bsed\s+-i|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|\bdel\b|\bren\b)/iu;

/**
 * 受保护的路径片段: 编排记录与防护配置.
 * @type {RegExp}
 */
const PROTECTED_PATH_PATTERN =
  /\.navigator[\\/]|\.claude[\\/](settings|rules)/iu;

/**
 * 编排会话派出的子代理运行了不允许的命令时的拒绝理由.
 * @type {string}
 */
const REVIEWER_COMMAND_REASON =
  "验收子代理只能运行只读 git 命令, 委派提示词中的源码证据核对命令, 以及用户已授权的测试命令.";

/**
 * @typedef {object} CommandContext 判定命令时需要的状态.
 * @property {string[]} authorizedTests 用户已授权的测试命令.
 * @property {boolean} isCommitStep 是否处于提交步骤 (工单已验收通过).
 * @property {boolean} [canVerifyEvidence] 是否可以运行核对源码证据的插件命令 (只有验收子代理可以).
 */

/**
 * 判定编排会话 (主会话) 的一条命令是否放行.
 *
 * @param {string} command 命令全文.
 * @param {CommandContext} context 判定上下文.
 * @returns {string | undefined} 拒绝理由; 放行时为 undefined.
 */
export function checkOrchestratorCommand(command, context) {
  const trimmed = command.trim();
  if (context.authorizedTests.includes(trimmed)) {
    return undefined;
  }
  if (context.isCommitStep && isAllowedCommitCommand(trimmed)) {
    return undefined;
  }
  if (COMPOUND_PATTERN.test(trimmed)) {
    return "编排会话不运行复合命令 (含管道, 重定向或多条命令串联); 请一次只运行一条插件命令或只读 git 命令.";
  }
  if (NAVIGATOR_COMMAND_PATTERN.test(trimmed) || isReadOnlyGit(trimmed)) {
    return undefined;
  }
  return "编排会话只运行三类命令: 插件命令 (node .navigator/bin/runtime/navigator.mjs ...), 只读 git 命令, 用户已授权的测试命令. 装依赖, 构建, 运行业务脚本都属于实现, 请发布工单交给执行会话.";
}

/**
 * 判定编排会话派出的子代理的一条命令: 放行只读 git 与已授权的测试命令;
 * 验收子代理另外可以运行不带参数的源码证据核对命令.
 *
 * @param {string} command 命令全文.
 * @param {CommandContext} context 判定上下文.
 * @returns {string | undefined} 拒绝理由; 放行时为 undefined.
 */
export function checkReviewerCommand(command, context) {
  const trimmed = command.trim();
  if (context.authorizedTests.includes(trimmed)) {
    return undefined;
  }
  if (COMPOUND_PATTERN.test(trimmed)) {
    return REVIEWER_COMMAND_REASON;
  }
  if (isReadOnlyGit(trimmed)) {
    return undefined;
  }
  if (context.canVerifyEvidence === true && isEvidenceCommand(trimmed)) {
    return undefined;
  }
  return REVIEWER_COMMAND_REASON;
}

/**
 * 判断命令是否为不带参数的源码证据核对命令.
 *
 * @param {string} command 去掉首尾空白的命令.
 * @returns {boolean} 是时返回 true.
 */
function isEvidenceCommand(command) {
  const match = NAVIGATOR_COMMAND_PATTERN.exec(command);
  return (
    match !== null &&
    command.slice(match[0].length).trim() === EVIDENCE_COMMAND_NAME
  );
}

/**
 * 判定执行会话或其它会话的一条命令: 执行会话禁止提交与推送; 所有会话都禁止
 * 用命令行改写编排记录与防护配置.
 *
 * @param {string} command 命令全文.
 * @param {boolean} isExecutor 是否为执行会话.
 * @returns {string | undefined} 拒绝理由; 放行时为 undefined.
 */
export function checkOtherCommand(command, isExecutor) {
  if (isExecutor && COMMIT_OR_PUSH_PATTERN.test(command)) {
    return "执行会话不提交, 不推送: 验收通过后由用户统一提交.";
  }
  if (
    PROTECTED_PATH_PATTERN.test(command) &&
    WRITE_OPERATION_PATTERN.test(command)
  ) {
    return "不能用命令行改写 .navigator/ 下的编排记录或 .claude/ 下的防护配置.";
  }
  return undefined;
}

/**
 * 判断命令是否为只读的 git 命令.
 *
 * @param {string} command 去掉首尾空白的命令.
 * @returns {boolean} 只读时返回 true.
 */
function isReadOnlyGit(command) {
  const words = command.split(/\s+/u);
  if (words[0] !== "git" || words[1] === undefined) {
    return false;
  }
  const [, subcommand, ...rest] = words;
  if (READ_ONLY_GIT_SUBCOMMANDS.includes(subcommand)) {
    return true;
  }
  if (subcommand === "branch" || subcommand === "remote") {
    return rest.every((argument) => LISTING_ARGUMENTS.includes(argument));
  }
  return false;
}

/**
 * 判断命令是否为提交步骤允许的 git 命令: 暂存, 提交, 推送 (不含禁止参数),
 * 以及 commit-message 技能传入提交消息的两种写法 (Bash heredoc 与 PowerShell 管道).
 *
 * @param {string} command 去掉首尾空白的命令.
 * @returns {boolean} 允许时返回 true.
 */
function isAllowedCommitCommand(command) {
  if (FORBIDDEN_COMMIT_FLAGS.test(` ${command} `)) {
    return false;
  }
  if (
    /^git\s+(add|push)(\s|$)/u.test(command) &&
    !COMPOUND_PATTERN.test(command)
  ) {
    return true;
  }
  const isHeredocCommit =
    /^git\s+commit\s+-F\s+-(\s+--\s+[^\n]*)?\s*<<'EOF'\n[\s\S]*\nEOF$/u.test(
      command,
    );
  const isPipedCommit =
    /^(\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)\s*\n)?@'\n[\s\S]*\n'@\s*\|\s*git\s+commit\s+-F\s+-(\s+--\s+[^\n]*)?$/u.test(
      command,
    );
  return isHeredocCommit || isPipedCommit;
}
