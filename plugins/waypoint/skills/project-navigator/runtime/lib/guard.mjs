/**
 * @file 工具调用守卫: 根据会话身份, 工具与参数决定放行或拒绝.
 *
 * 编排会话按工具白名单默认拒绝, 这样新出现的工具 (例如 Monitor, Workflow,
 * MCP 写工具) 也不能绕过限制; 执行会话与其它会话只限制写入路径与少数命令.
 * 本模块只做判定, 读文件通过注入的函数完成, 便于用决策表测试.
 */

import {
  checkOrchestratorCommand,
  checkOtherCommand,
  checkReviewerCommand,
} from "./guard-commands.mjs";
import { decideProjectWrite } from "./guard-paths.mjs";
import { projectRelativePath } from "./paths.mjs";

/**
 * 会写入文件的工具名.
 * @type {readonly string[]}
 */
export const WRITE_TOOLS = Object.freeze([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

/**
 * 插件自带的子代理类型, 以及编排会话可以派出的内置类型.
 * @type {Readonly<Record<string, string>>}
 */
export const SUBAGENT_TYPES = Object.freeze({
  reader: "waypoint:navigator-reader",
  reviewer: "waypoint:navigator-reviewer",
  researcher: "waypoint:navigator-researcher",
  explore: "Explore",
});

/**
 * 编排会话在提交步骤可以调用的技能.
 * @type {string}
 */
export const COMMIT_SKILL = "waypoint:commit-message";

/**
 * 提交步骤中的工单状态: 验收通过等待提交, 以及正在提交.
 * @type {readonly string[]}
 */
const COMMIT_STEP_STATUSES = Object.freeze(["accepted", "committing"]);

/**
 * 只读工具, 编排会话与其子代理都可以使用.
 * @type {readonly string[]}
 */
const READ_TOOLS = Object.freeze([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
]);

/**
 * 编排会话额外可以使用的工具: 加载工具定义, 查看与联系其它会话, 任务清单.
 * @type {readonly string[]}
 */
const ORCHESTRATOR_EXTRA_TOOLS = Object.freeze([
  "ToolSearch",
  "ListAgents",
  "SendMessage",
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
]);

/**
 * 运行命令的工具.
 * @type {readonly string[]}
 */
const SHELL_TOOLS = Object.freeze(["Bash", "PowerShell"]);

/**
 * 派出子代理的工具.
 * @type {readonly string[]}
 */
const AGENT_TOOLS = Object.freeze(["Agent", "Task"]);

/**
 * 联网工具, 只有调研子代理可以使用.
 * @type {readonly string[]}
 */
const WEB_TOOLS = Object.freeze(["WebSearch", "WebFetch"]);

/**
 * @typedef {"orchestrator" | "executor" | "other"} SessionRole 会话身份.
 */

/**
 * @typedef {object} GuardContext 判定时需要的状态.
 * @property {string | undefined} orderStatus 当前工单状态.
 * @property {string[]} authorizedTests 当前工单可以运行的测试命令: 代码检查命令与用户授权的测试.
 * @property {string | undefined} executorFolder 执行会话绑定的工单文件夹名.
 * @property {boolean} isOrderActive 执行会话绑定的工单是否为当前工单且处于已发布状态.
 * @property {boolean} isAligned 执行会话是否已就本轮发布完成开工对齐.
 * @property {string | undefined} reviewBrief 当前工单的验收委派提示词.
 * @property {string} researchFrame 问题域调研委派提示词的固定框架.
 */

/**
 * @typedef {object} GuardInput 守卫的输入.
 * @property {SessionRole} role 发起调用的会话身份.
 * @property {boolean} isSubagent 调用是否来自子代理.
 * @property {string | undefined} agentType 子代理类型.
 * @property {string} toolName 工具名.
 * @property {Record<string, any>} toolInput 工具参数.
 * @property {string} projectRoot 项目根目录.
 * @property {GuardContext} context 状态上下文.
 * @property {(relativePath: string) => string | undefined} readFile 读取项目内文件当前内容.
 * @property {import("./spec.mjs").TemplateSpec} spec 模板规格.
 */

/**
 * @typedef {object} GuardDecision 守卫的判定.
 * @property {"allow" | "deny"} decision 放行或拒绝.
 * @property {string} [reason] 拒绝理由.
 * @property {boolean} [isProbe] 是否为初始化自检的探测写入.
 */

/**
 * 对一次工具调用作出判定.
 *
 * @param {GuardInput} input 守卫输入.
 * @returns {GuardDecision} 判定结果.
 */
export function decideToolUse(input) {
  if (input.role === "orchestrator") {
    return input.isSubagent
      ? decideSubagentTool(input)
      : decideOrchestratorTool(input);
  }
  if (WRITE_TOOLS.includes(input.toolName)) {
    return decideWrite(input);
  }
  if (SHELL_TOOLS.includes(input.toolName)) {
    return toDecision(
      checkOtherCommand(
        String(input.toolInput.command ?? ""),
        input.role === "executor",
      ),
    );
  }
  return allow();
}

/**
 * 判定编排会话主会话的工具调用: 白名单之外一律拒绝.
 *
 * @param {GuardInput} input 守卫输入.
 * @returns {GuardDecision} 判定结果.
 */
function decideOrchestratorTool(input) {
  const { toolName, toolInput, context } = input;
  if (
    READ_TOOLS.includes(toolName) ||
    ORCHESTRATOR_EXTRA_TOOLS.includes(toolName)
  ) {
    return allow();
  }
  if (WRITE_TOOLS.includes(toolName)) {
    return decideWrite(input);
  }
  if (SHELL_TOOLS.includes(toolName)) {
    return toDecision(
      checkOrchestratorCommand(String(toolInput.command ?? ""), {
        authorizedTests: context.authorizedTests,
        isCommitStep: COMMIT_STEP_STATUSES.includes(context.orderStatus ?? ""),
      }),
    );
  }
  if (AGENT_TOOLS.includes(toolName)) {
    return decideAgent(toolInput, context);
  }
  if (toolName === "Skill") {
    return toolInput.skill === COMMIT_SKILL &&
      COMMIT_STEP_STATUSES.includes(context.orderStatus ?? "")
      ? allow()
      : deny(
          `编排会话只在提交步骤调用 ${COMMIT_SKILL}; 其它技能与其它时机都不调用.`,
        );
  }
  if (toolName === "AskUserQuestion") {
    return deny(
      "编排会话不用提问框: 提问框之前的正文用户看不到. 请用回复末尾的选项块提问.",
    );
  }
  return deny(
    `编排会话不使用 ${toolName}: 调研交给调研子代理, 实现交给执行会话.`,
  );
}

/**
 * 判定编排会话派出子代理: 只能派规定的类型, 验收与调研子代理的提示词必须用
 * 插件命令生成, 防止编排会话在提示词里加入倾向性说明.
 *
 * @param {Record<string, any>} toolInput 工具参数.
 * @param {GuardContext} context 状态上下文.
 * @returns {GuardDecision} 判定结果.
 */
function decideAgent(toolInput, context) {
  const type = String(toolInput.subagent_type ?? "");
  const prompt = String(toolInput.prompt ?? "");
  if (!Object.values(SUBAGENT_TYPES).includes(type)) {
    return deny(
      `编排会话只能派以下子代理: ${Object.values(SUBAGENT_TYPES).join(", ")}.`,
    );
  }
  if (
    type === SUBAGENT_TYPES.reviewer &&
    prompt.trim() !== (context.reviewBrief ?? "").trim()
  ) {
    return deny(
      "验收子代理的提示词必须与 review-brief 命令的输出逐字一致, 不能增删内容.",
    );
  }
  if (
    type === SUBAGENT_TYPES.researcher &&
    !prompt.startsWith(context.researchFrame)
  ) {
    return deny(
      "调研子代理的提示词必须以 research-brief 命令输出的固定框架开头, 只在其后填写调研问题.",
    );
  }
  return allow();
}

/**
 * 判定编排会话子代理的工具调用: 只读; 调研子代理可以联网; 验收子代理可以运行
 * 只读 git 与已授权测试; 其它子代理只能运行只读 git.
 *
 * @param {GuardInput} input 守卫输入.
 * @returns {GuardDecision} 判定结果.
 */
function decideSubagentTool(input) {
  const { toolName, toolInput, agentType, context } = input;
  if (READ_TOOLS.includes(toolName)) {
    return allow();
  }
  if (WEB_TOOLS.includes(toolName)) {
    return agentType === SUBAGENT_TYPES.researcher
      ? allow()
      : deny("只有调研子代理可以联网.");
  }
  if (SHELL_TOOLS.includes(toolName)) {
    return toDecision(
      checkReviewerCommand(String(toolInput.command ?? ""), {
        authorizedTests:
          agentType === SUBAGENT_TYPES.reviewer ? context.authorizedTests : [],
        isCommitStep: false,
      }),
    );
  }
  if (WRITE_TOOLS.includes(toolName)) {
    return deny("编排会话派出的子代理只能读, 不能写任何文件.");
  }
  return deny(`编排会话派出的子代理不使用 ${toolName}.`);
}

/**
 * 判定写入类工具: 项目之外的写入只限制编排会话, 项目内按路径规则判定.
 *
 * @param {GuardInput} input 守卫输入.
 * @returns {GuardDecision} 判定结果.
 */
function decideWrite(input) {
  const value = input.toolInput.file_path ?? input.toolInput.notebook_path;
  const target = typeof value === "string" && value !== "" ? value : undefined;
  const relativePath =
    target === undefined
      ? undefined
      : projectRelativePath(input.projectRoot, target);
  if (relativePath === undefined) {
    return input.role === "orchestrator"
      ? deny("编排会话只能写 .navigator/ 下的编排记录, 不能写项目之外的文件.")
      : allow();
  }
  return decideProjectWrite({
    role: input.role,
    isSubagent: input.isSubagent,
    relativePath,
    toolName: input.toolName,
    toolInput: input.toolInput,
    context: input.context,
    readFile: input.readFile,
    spec: input.spec,
  });
}

/**
 * 把拒绝理由转换为判定: 有理由则拒绝, 否则放行.
 *
 * @param {string | undefined} reason 拒绝理由.
 * @returns {GuardDecision} 判定结果.
 */
function toDecision(reason) {
  return reason === undefined ? allow() : deny(reason);
}

/**
 * 构造放行判定.
 *
 * @returns {GuardDecision} 放行判定.
 */
function allow() {
  return { decision: "allow" };
}

/**
 * 构造拒绝判定.
 *
 * @param {string} reason 拒绝理由.
 * @returns {GuardDecision} 拒绝判定.
 */
function deny(reason) {
  return { decision: "deny", reason };
}
