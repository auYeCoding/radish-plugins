/**
 * @file 命令行守卫: 编排会话的命令白名单, 以及执行会话与其它会话的命令禁令.
 *
 * 编排会话只允许三类命令: 插件自带的命令行脚本, 只读的 git 命令, 用户已授权的
 * 测试命令; 到了提交步骤, 再放行提交所需的 git 命令. 验收子代理另外可以运行
 * 核对源码证据的插件命令. 含有管道, 重定向, 命令串联等 shell 元字符的命令
 * 一律视为复合命令, 除非与已授权的测试命令逐字相同. 执行会话与其它会话只能
 * 运行只读的插件命令, 改变编排状态的插件命令只有编排会话能运行.
 */

import {
  EVIDENCE_COMMAND_NAME,
  SHARED_COMMANDS,
  isOrchestratorOnly,
} from "./command-access.mjs";
import {
  OTHER_SESSION_GUIDE,
  RECLAIM_GUIDE,
  SUPERSEDED_NOTICE,
} from "./session-notices.mjs";

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
 * 命令中出现的插件命令调用: 由 node 运行 `navigator.mjs`, 其后第一个词是命令名.
 * 脚本路径可以带引号与空格. 不要求调用位于开头, 复合命令与先切换目录再运行的
 * 写法也能找到; 只提到文件名而不运行它的命令 (例如搜索文件内容) 不算调用.
 * @type {RegExp}
 */
const NAVIGATOR_INVOCATION_PATTERN =
  /\bnode(?:\.exe)?["']?\s+(?:-\S+\s+)*(?:"[^"]*|'[^']*|[^\s"';&|]*)navigator\.mjs["']?\s+([^\s;&|<>`"']+)/giu;

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
 * git 与子命令之间可以夹带的全局参数, 例如 `-c core.quotePath=false`.
 * @type {string}
 */
const GIT_WITH_GLOBAL_OPTIONS = String.raw`\bgit(\s+-[^\s]+(\s+[^-\s][^\s]*)?)*\s+`;

/**
 * 一条命令中出现提交或推送的形式.
 * @type {RegExp}
 */
const COMMIT_OR_PUSH_PATTERN = new RegExp(
  `${GIT_WITH_GLOBAL_OPTIONS}(commit|push)\\b`,
  "u",
);

/**
 * 一条命令中出现暂存, 提交或推送的形式; 提交步骤中写法不对时据此给出正确写法.
 * @type {RegExp}
 */
const COMMIT_STEP_GIT_PATTERN = new RegExp(
  `${GIT_WITH_GLOBAL_OPTIONS}(add|commit|push)\\b`,
  "u",
);

/**
 * 提交步骤放行的写法, 拒绝理由与编排会话的提醒共用. 只放行经标准输入传入提交消息
 * 的写法: Windows PowerShell 5.1 向外部命令传中文参数会乱码.
 * @type {string}
 */
export const COMMIT_COMMAND_FORMS =
  "提交步骤只放行以下写法: 暂存用 `git add -- <路径...>`; 提交消息经标准输入传给 `git commit -F -`, Bash 写成 heredoc (`git commit -F - <<'EOF'`, 消息, `EOF`), PowerShell 写成首行 `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`, 其后 `@'`, 消息, `'@ | git commit -F -`; 只提交部分路径时在 `git commit -F -` 之后加 `-- <路径...>`; 推送用不带强制参数的 `git push`. 不用 `-m`, 也不用 `-F <文件>`.";

/**
 * 编排会话运行复合命令时的拒绝理由.
 * @type {string}
 */
const ORCHESTRATOR_COMPOUND_REASON =
  "编排会话不运行复合命令 (含管道, 重定向或多条命令串联); 请一次只运行一条插件命令或只读 git 命令.";

/**
 * git 与子命令之间带了全局参数 (例如 `-C <目录>`) 时的补充说明. 只读判断按
 * 紧跟 git 的子命令进行, 带全局参数的写法认不出子命令, 一律拒绝.
 * @type {string}
 */
const GIT_GLOBAL_OPTION_HINT =
  "git 命令不带 `-C <目录>` 等全局参数: 工作目录已是仓库根目录, 直接写 `git <子命令> ...`.";

/**
 * 验收子代理运行复合命令时的拒绝理由.
 * @type {string}
 */
const REVIEWER_COMPOUND_REASON =
  "验收子代理一次只运行一条命令, 不用 `&&`, `;`, `|` 串联, 也不用重定向; 请把只读 git 命令逐条分开运行.";

/**
 * 编排会话运行白名单之外的命令时的拒绝理由.
 * @type {string}
 */
const ORCHESTRATOR_COMMAND_REASON =
  "编排会话只运行三类命令: 插件命令 (node .navigator/bin/runtime/navigator.mjs ...), 只读 git 命令, 用户已授权的测试命令. 装依赖, 构建, 运行业务脚本都属于实现, 请发布工单交给执行会话.";

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
 * 由 node 运行插件脚本的部分: 脚本本身位于 `.navigator/` 下, 运行它不是改写.
 * 只认 node 之后的脚本路径; 作为其它命令参数出现的同一路径 (例如复制的目标)
 * 仍按受保护路径处理.
 * @type {RegExp}
 */
const NAVIGATOR_SCRIPT_RUN_PATTERN =
  /\bnode(?:\.exe)?["']?\s+(?:-\S+\s+)*(?:"[^"]*navigator\.mjs"|'[^']*navigator\.mjs'|[^\s"';&|<>]*navigator\.mjs)/giu;

/**
 * 不写文件的重定向: 文件描述符之间的复制 (例如 `2>&1`, `>&2`), 以及写到空设备
 * (`/dev/null`, PowerShell 的 `$null`, cmd 的 `NUL`).
 * @type {RegExp}
 */
const HARMLESS_REDIRECT_PATTERN =
  /[\d*]?>&\d+|[\d*]?>>?\s*(?:\/dev\/null|\$null|nul)(?=$|[\s;&|)])/giu;

/**
 * 执行会话与其它会话用命令行改写受保护路径时的拒绝理由.
 * @type {string}
 */
const PROTECTED_WRITE_REASON =
  "命令中有写文件的操作 (重定向到文件, tee, 删除, 移动, 复制等), 且涉及 .navigator/ 下的编排记录或 .claude/ 下的防护配置; 这些文件不能用命令行改写. 插件命令的输出直接读取即可, 不需要重定向到文件.";

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
 * 判定编排会话 (主会话) 的一条命令是否放行. 提交步骤中被拒绝的复合命令与
 * 暂存, 提交, 推送命令, 拒绝理由附上放行的写法, 让模型换成正确写法, 而不是
 * 误以为不能提交.
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
    return context.isCommitStep
      ? `${ORCHESTRATOR_COMPOUND_REASON} ${COMMIT_COMMAND_FORMS}`
      : ORCHESTRATOR_COMPOUND_REASON;
  }
  if (NAVIGATOR_COMMAND_PATTERN.test(trimmed) || isReadOnlyGit(trimmed)) {
    return undefined;
  }
  if (context.isCommitStep && COMMIT_STEP_GIT_PATTERN.test(trimmed)) {
    return `守卫不放行这种写法. ${COMMIT_COMMAND_FORMS}`;
  }
  return hasGitGlobalOption(trimmed)
    ? `${ORCHESTRATOR_COMMAND_REASON} ${GIT_GLOBAL_OPTION_HINT}`
    : ORCHESTRATOR_COMMAND_REASON;
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
    return REVIEWER_COMPOUND_REASON;
  }
  if (isReadOnlyGit(trimmed)) {
    return undefined;
  }
  if (context.canVerifyEvidence === true && isEvidenceCommand(trimmed)) {
    return undefined;
  }
  return hasGitGlobalOption(trimmed)
    ? `${REVIEWER_COMMAND_REASON} ${GIT_GLOBAL_OPTION_HINT}`
    : REVIEWER_COMMAND_REASON;
}

/**
 * 判断 git 命令是否在子命令之前带了全局参数, 例如 `git -C <目录> status`.
 *
 * @param {string} command 去掉首尾空白的命令.
 * @returns {boolean} 带全局参数时返回 true.
 */
function hasGitGlobalOption(command) {
  const words = command.split(/\s+/u);
  return words[0] === "git" && (words[1]?.startsWith("-") ?? false);
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
 * 判定编排会话主会话之外的会话 (执行会话, 被接管的原编排会话, 其它会话) 的
 * 一条命令: 只能运行只读的插件命令; 执行会话禁止提交与推送; 所有会话都禁止
 * 用命令行改写编排记录与防护配置.
 *
 * @param {string} command 命令全文.
 * @param {"executor" | "superseded" | "other"} role 会话身份.
 * @returns {string | undefined} 拒绝理由; 放行时为 undefined.
 */
export function checkOtherCommand(command, role) {
  const restricted = findOrchestratorOnlyCommand(command);
  if (restricted !== undefined) {
    return orchestratorOnlyReason(restricted, role);
  }
  if (role === "executor" && COMMIT_OR_PUSH_PATTERN.test(command)) {
    return "执行会话不提交, 不推送: 验收通过后由用户统一提交.";
  }
  return writesProtectedPath(command) ? PROTECTED_WRITE_REASON : undefined;
}

/**
 * 粗查命令是否用命令行改写受保护的路径. 先去掉运行插件脚本的部分与不写文件的
 * 重定向: 否则脚本路径本身会被当成受保护路径, `2>&1` 会被当成写入, 所有带
 * 重定向的插件命令都会被拒绝.
 *
 * @param {string} command 命令全文.
 * @returns {boolean} 可能改写受保护路径时返回 true.
 */
function writesProtectedPath(command) {
  const remaining = command
    .replace(NAVIGATOR_SCRIPT_RUN_PATTERN, "node navigator.mjs")
    .replace(HARMLESS_REDIRECT_PATTERN, " ");
  return (
    PROTECTED_PATH_PATTERN.test(remaining) &&
    WRITE_OPERATION_PATTERN.test(remaining)
  );
}

/**
 * 找出命令中第一个只有编排会话能运行的插件命令.
 *
 * @param {string} command 命令全文.
 * @returns {string | undefined} 命令名; 没有时为 undefined.
 */
function findOrchestratorOnlyCommand(command) {
  return [...command.matchAll(NAVIGATOR_INVOCATION_PATTERN)]
    .map((match) => match[1])
    .find((name) => isOrchestratorOnly(name));
}

/**
 * 生成非编排会话运行编排命令时的拒绝理由, 按会话身份写明正确做法.
 *
 * @param {string} name 插件命令名.
 * @param {"executor" | "superseded" | "other"} role 会话身份.
 * @returns {string} 拒绝理由.
 */
function orchestratorOnlyReason(name, role) {
  switch (role) {
    case "executor":
      return `执行会话只能运行只读的插件命令 (${SHARED_COMMANDS.join(", ")}); ${name} 会改变编排状态, 由编排会话运行. 执行中的发现写进回执.`;
    case "superseded":
      return `${SUPERSEDED_NOTICE}, 不能运行插件命令 ${name}. ${RECLAIM_GUIDE}.`;
    default:
      return `只有编排会话能运行插件命令 ${name}. ${OTHER_SESSION_GUIDE}.`;
  }
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
