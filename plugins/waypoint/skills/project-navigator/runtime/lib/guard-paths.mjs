/**
 * @file 写入守卫: 按会话身份判断能写哪些路径, 并在写入前校验记录文件的结构.
 */

import { reconstructContent } from "./edits.mjs";
import { checkFile, findFileSpec } from "./file-checks.mjs";
import {
  BIN_DIRECTORY,
  DRAFTS_DIRECTORY,
  GENERATED_FILES,
  NAVIGATOR_DIRECTORY,
  PROBE_FILE,
  PROTECTED_CONFIG_FILES,
  isUnderDirectory,
  orderArtifactsPath,
  orderFilePath,
  relativePathsEqual,
} from "./paths.mjs";
import {
  OTHER_SESSION_GUIDE,
  RECLAIM_GUIDE,
  SUPERSEDED_NOTICE,
} from "./session-notices.mjs";
import { USER_TESTS_FILE_KIND, checkUserOutputs } from "./user-tests.mjs";

/**
 * 编排会话可以直接编写的记录文件扩展名.
 * @type {string}
 */
const RECORD_EXTENSION = ".md";

/**
 * 执行会话在开工对齐之前改动业务文件或证据文件时的拒绝理由.
 * @type {string}
 */
const EXECUTOR_UNALIGNED_REASON =
  '开工对齐尚未完成: 请先按 "开工对齐" 版式回复, 等用户选择 "A. 继续执行." 后再改动业务文件或证据文件.';

/**
 * 执行会话写本工单回执与证据文件之外的编排记录时的拒绝理由.
 * @type {string}
 */
const EXECUTOR_RECORD_REASON =
  ".navigator/ 下只能写本工单的回执, 以及本工单文件夹 artifacts/ 下的证据文件; 其它文件是编排记录, 执行中的发现请写进回执或汇报给编排会话.";

/**
 * @typedef {object} WriteRequest 一次项目内写入.
 * @property {import("./guard.mjs").SessionRole} role 会话身份.
 * @property {boolean} isSubagent 是否来自子代理.
 * @property {string} relativePath 目标的项目相对路径.
 * @property {string} toolName 工具名.
 * @property {Record<string, any>} toolInput 工具参数.
 * @property {import("./guard.mjs").GuardContext} context 状态上下文.
 * @property {(relativePath: string) => string | undefined} readFile 读取项目内文件当前内容.
 * @property {() => string[]} readRecentPrompts 读取编排会话最近收到的用户消息.
 * @property {import("./spec.mjs").TemplateSpec} spec 模板规格.
 */

/**
 * 判定一次项目内写入.
 *
 * @param {WriteRequest} request 写入请求.
 * @returns {import("./guard.mjs").GuardDecision} 判定结果.
 */
export function decideProjectWrite(request) {
  const { relativePath } = request;
  if (relativePathsEqual(relativePath, PROBE_FILE)) {
    return { ...deny("初始化自检: 探测写入已被守卫拦下."), isProbe: true };
  }
  if (isProtected(relativePath)) {
    return deny(
      `${relativePath} 是防护配置或插件脚本, 只能由插件的 init 与 uninstall 命令修改.`,
    );
  }
  switch (request.role) {
    case "orchestrator":
      return decideOrchestratorWrite(request);
    case "executor":
      return decideExecutorWrite(request);
    default:
      return isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY)
        ? deny(nonOrchestratorRecordReason(request.role))
        : allow();
  }
}

/**
 * 生成被接管的原编排会话或其它会话写编排记录时的拒绝理由.
 *
 * @param {import("./sessions.mjs").SessionRole} role 会话身份.
 * @returns {string} 拒绝理由.
 */
function nonOrchestratorRecordReason(role) {
  return role === "superseded"
    ? `${SUPERSEDED_NOTICE}, 不能再写 .navigator/ 下的编排记录. ${RECLAIM_GUIDE}.`
    : `.navigator/ 下是编排记录, 只有编排会话能写. ${OTHER_SESSION_GUIDE}.`;
}

/**
 * 判定编排会话 (含其子代理) 的写入.
 *
 * @param {WriteRequest} request 写入请求.
 * @returns {import("./guard.mjs").GuardDecision} 判定结果.
 */
function decideOrchestratorWrite(request) {
  const { relativePath } = request;
  if (request.isSubagent) {
    return deny("编排会话派出的子代理只能读, 不能写任何文件.");
  }
  if (!isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY)) {
    return deny(
      "编排会话不写业务代码, 也不改 .navigator/ 以外的文件; 需要改动时请发布工单, 交给执行会话.",
    );
  }
  if (isUnderDirectory(relativePath, DRAFTS_DIRECTORY)) {
    return allow();
  }
  if (GENERATED_FILES.some((file) => relativePathsEqual(relativePath, file))) {
    return deny(`${relativePath} 由脚本生成, 请用插件命令修改状态后自动更新.`);
  }
  if (!relativePath.toLowerCase().endsWith(RECORD_EXTENSION)) {
    return deny(
      "状态与编号只能通过插件命令修改; 编排会话只直接编写 .navigator/ 下的 Markdown 记录与 drafts/ 下的草稿.",
    );
  }
  return checkStructure(request);
}

/**
 * 判定执行会话的写入: 只能写本工单回执, 本工单的证据文件与业务文件;
 * 对齐之前不能写证据文件与业务文件.
 *
 * @param {WriteRequest} request 写入请求.
 * @returns {import("./guard.mjs").GuardDecision} 判定结果.
 */
function decideExecutorWrite(request) {
  const { relativePath, context } = request;
  if (!context.isOrderActive) {
    return deny(
      "本会话绑定的工单已不在执行中 (已提交, 已作废, 验收中, 受阻待修改或被撤回修改), 不能再改动文件. 请回到编排会话确认下一步; 工单重新发布后, 先重新开工对齐.",
    );
  }
  if (isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY)) {
    return decideExecutorRecordWrite(request);
  }
  return context.isAligned ? allow() : deny(EXECUTOR_UNALIGNED_REASON);
}

/**
 * 判定执行会话在状态目录中的写入: 本工单回执任何时候都能写 (受阻时可能还没有
 * 对齐), 本工单的证据文件在对齐之后能写, 其它编排记录一律拒绝.
 *
 * @param {WriteRequest} request 写入请求.
 * @returns {import("./guard.mjs").GuardDecision} 判定结果.
 */
function decideExecutorRecordWrite(request) {
  const { relativePath, context } = request;
  const folder = context.executorFolder;
  if (folder === undefined) {
    return deny(EXECUTOR_RECORD_REASON);
  }
  if (relativePathsEqual(relativePath, orderFilePath(folder, "receipt"))) {
    return checkStructure(request);
  }
  if (isUnderDirectory(relativePath, orderArtifactsPath(folder))) {
    return context.isAligned ? allow() : deny(EXECUTOR_UNALIGNED_REASON);
  }
  return deny(EXECUTOR_RECORD_REASON);
}

/**
 * 写入前校验记录文件的结构; 用户测试记录另外核对新写入的输出与用户消息逐字一致.
 * 没有规格的文件与无法重建内容的编辑直接放行.
 *
 * @param {WriteRequest} request 写入请求.
 * @returns {import("./guard.mjs").GuardDecision} 判定结果.
 */
function checkStructure(request) {
  const fileSpec = findFileSpec(request.spec, request.relativePath);
  if (fileSpec === undefined) {
    return allow();
  }
  const previous = request.readFile(request.relativePath);
  const content = reconstructContent(
    request.toolName,
    request.toolInput,
    previous,
  );
  if (content === undefined) {
    return allow();
  }
  const problems = checkFile({ text: content, fileSpec, spec: request.spec });
  if (problems.length > 0) {
    return denyWithProblems(
      `${request.relativePath} 的结构不符合规格, 本次写入已拦下. 请修改后重写:`,
      problems,
    );
  }
  if (fileSpec !== request.spec.files[USER_TESTS_FILE_KIND]) {
    return allow();
  }
  const outputProblems = checkUserOutputs({
    content,
    previous,
    prompts: request.readRecentPrompts(),
    language: fileSpec.entryBlock ?? "",
  });
  return outputProblems.length === 0
    ? allow()
    : denyWithProblems(
        `${request.relativePath} 中的输出必须与用户消息逐字一致, 本次写入已拦下:`,
        outputProblems,
      );
}

/**
 * 构造列出问题的拒绝判定.
 *
 * @param {string} header 第一行说明.
 * @param {readonly string[]} problems 问题列表.
 * @returns {import("./guard.mjs").GuardDecision} 拒绝判定.
 */
function denyWithProblems(header, problems) {
  return deny(
    [
      header,
      ...problems.map((problem, index) => `${index + 1}. ${problem}`),
    ].join("\n"),
  );
}

/**
 * 判断路径是否受保护: 防护配置文件或插件脚本目录.
 *
 * @param {string} relativePath 项目相对路径.
 * @returns {boolean} 受保护时返回 true.
 */
function isProtected(relativePath) {
  return (
    PROTECTED_CONFIG_FILES.some((file) =>
      relativePathsEqual(relativePath, file),
    ) || isUnderDirectory(relativePath, BIN_DIRECTORY)
  );
}

/**
 * 构造放行判定.
 *
 * @returns {import("./guard.mjs").GuardDecision} 放行判定.
 */
function allow() {
  return { decision: "allow" };
}

/**
 * 构造拒绝判定.
 *
 * @param {string} reason 拒绝理由.
 * @returns {import("./guard.mjs").GuardDecision} 拒绝判定.
 */
function deny(reason) {
  return { decision: "deny", reason };
}
