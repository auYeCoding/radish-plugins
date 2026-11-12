/**
 * @file 写入守卫: 只看写入类工具的目标路径, 四条规则.
 *
 * 1. 任何会话与子代理都不能直接写状态文件与脚本生成的路线视图.
 * 2. 验收子代理不能写任何文件.
 * 3. 实现子代理在 `.navigator/` 下只能写进行中的切片文件与结论目录.
 * 4. 编排会话不能写 `.navigator/` 之外的文件.
 *
 * 命令行与其它工具不检查: 守卫只管不会误伤正常工作的几条边界, 其余靠技能规则.
 * 本模块只做判定, 是否为编排会话由调用方通过注入的函数判断 (需要读转录).
 */

import {
  FINDINGS_DIRECTORY,
  GENERATED_FILES,
  NAVIGATOR_DIRECTORY,
  isUnderDirectory,
  projectRelativePath,
  relativePathsEqual,
} from "./paths.mjs";

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
 * 插件自带的子代理类型.
 * @type {Readonly<{executor: string, reviewer: string}>}
 */
export const SUBAGENT_TYPES = Object.freeze({
  executor: "waypoint:navigator-executor",
  reviewer: "waypoint:navigator-reviewer",
});

/**
 * 生成提交消息并提交的技能.
 * @type {string}
 */
export const COMMIT_SKILL = "waypoint:commit-message";

/**
 * 写生成文件时的拒绝理由.
 * @type {string}
 */
const GENERATED_REASON =
  "这个文件由插件命令生成: 状态只用插件命令修改, 路线视图随状态自动更新.";

/**
 * 验收子代理写文件时的拒绝理由.
 * @type {string}
 */
const REVIEWER_REASON = "验收子代理只读, 不写任何文件; 只报告事实与证据.";

/**
 * 实现子代理写其它编排记录时的拒绝理由.
 * @type {string}
 */
const EXECUTOR_REASON = `${NAVIGATOR_DIRECTORY}/ 下只能写进行中的切片文件与 ${FINDINGS_DIRECTORY}/ 下的结论文件; 其它文件是编排记录, 需要改动时写进执行结果, 交回编排会话.`;

/**
 * 编排会话写业务文件时的拒绝理由.
 * @type {string}
 */
const ORCHESTRATOR_REASON = `编排会话只写 ${NAVIGATOR_DIRECTORY}/ 下的编排记录, 不写业务代码与项目配置; 需要改动时排进切片, 交给实现子代理.`;

/**
 * @typedef {object} WriteRequest 一次写入的判定输入.
 * @property {string} projectRoot 项目根目录.
 * @property {Record<string, any>} toolInput 工具参数.
 * @property {boolean} isSubagent 调用是否来自子代理.
 * @property {string | undefined} agentType 子代理类型.
 * @property {string | null} sliceFile 进行中的切片文件的项目相对路径; 没有时为 null.
 * @property {() => boolean} isOrchestrator 判断主会话是否为编排会话; 只在需要时调用.
 */

/**
 * @typedef {object} GuardDecision 守卫的判定.
 * @property {"allow" | "deny"} decision 放行或拒绝.
 * @property {string} [reason] 拒绝理由.
 */

/**
 * 判定一次写入类工具的调用.
 *
 * @param {WriteRequest} request 判定输入.
 * @returns {GuardDecision} 判定结果.
 */
export function decideWrite(request) {
  const value = request.toolInput.file_path ?? request.toolInput.notebook_path;
  const relativePath =
    typeof value === "string" && value !== ""
      ? projectRelativePath(request.projectRoot, value)
      : undefined;
  if (relativePath === undefined) {
    return allow();
  }
  if (GENERATED_FILES.some((file) => relativePathsEqual(relativePath, file))) {
    return deny(GENERATED_REASON);
  }
  if (request.agentType === SUBAGENT_TYPES.reviewer) {
    return deny(REVIEWER_REASON);
  }
  const isRecord = isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY);
  if (request.agentType === SUBAGENT_TYPES.executor) {
    return !isRecord || isExecutorRecord(relativePath, request.sliceFile)
      ? allow()
      : deny(EXECUTOR_REASON);
  }
  if (request.isSubagent || isRecord) {
    return allow();
  }
  return request.isOrchestrator() ? deny(ORCHESTRATOR_REASON) : allow();
}

/**
 * 判断 `.navigator/` 下的路径是否是实现子代理可以写的: 进行中的切片文件, 或
 * 结论目录下的文件.
 *
 * @param {string} relativePath 目标的项目相对路径.
 * @param {string | null} sliceFile 进行中的切片文件.
 * @returns {boolean} 可以写时返回 true.
 */
function isExecutorRecord(relativePath, sliceFile) {
  return (
    isUnderDirectory(relativePath, FINDINGS_DIRECTORY) ||
    (sliceFile !== null && relativePathsEqual(relativePath, sliceFile))
  );
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
