/**
 * @file 写入守卫: 只看写入类工具的目标路径, 四条规则.
 *
 * 1. 任何会话与子代理都不能直接写状态文件与脚本生成的视图文件.
 * 2. 验收子代理不能写任何文件.
 * 3. 执行子代理在 `.navigator/` 下只能写当前工单的回执与证据文件; 只产出记录的
 *    工单 (运行检查与分析) 不能写业务文件.
 * 4. 编排会话不能写 `.navigator/` 之外的文件.
 *
 * 命令行与其它工具不检查: 守卫只管不会误伤正常工作的几条边界, 其余靠技能规则.
 * 本模块只做判定, 是否为编排会话由调用方通过注入的函数判断 (需要读转录).
 */

import {
  GENERATED_FILES,
  NAVIGATOR_DIRECTORY,
  isUnderDirectory,
  orderArtifactsPath,
  orderFilePath,
  projectRelativePath,
  relativePathsEqual,
} from "./paths.mjs";
import {
  ISSUED_ORDER_STATUS,
  isRecordOnlyOrderKind,
} from "./workflow-orders.mjs";

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
 * @type {Readonly<{reader: string, researcher: string, reviewer: string, executor: string}>}
 */
export const SUBAGENT_TYPES = Object.freeze({
  reader: "waypoint:navigator-reader",
  researcher: "waypoint:navigator-researcher",
  reviewer: "waypoint:navigator-reviewer",
  executor: "waypoint:navigator-executor",
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
  "这个文件由插件命令生成: 状态只用插件命令修改, 推进路线与风险清单随状态自动更新.";

/**
 * 验收子代理写文件时的拒绝理由.
 * @type {string}
 */
const REVIEWER_REASON = "验收子代理只读, 不写任何文件; 只报告事实与证据.";

/**
 * 执行子代理写本工单回执与证据文件之外的编排记录时的拒绝理由.
 * @type {string}
 */
const EXECUTOR_RECORD_REASON =
  ".navigator/ 下只能写本工单的回执, 以及本工单文件夹 artifacts/ 下的证据文件; 其它文件是编排记录, 执行中的发现写进回执.";

/**
 * 工单不在执行中时, 执行子代理改动业务文件的拒绝理由.
 * @type {string}
 */
const EXECUTOR_INACTIVE_REASON =
  "当前工单不在执行中 (已结束, 验收中, 受阻或被撤回修改), 不能再改动业务文件. 写进回执, 交回编排会话.";

/**
 * 只产出记录的工单的执行子代理改动业务文件时的拒绝理由.
 * @type {string}
 */
const EXECUTOR_RECORD_ONLY_REASON =
  "本工单是运行检查或分析工单, 只产出记录: 只能写本工单的回执, 以及本工单文件夹 artifacts/ 下的文档, 脚本等证据文件, 不能改动业务文件与项目配置. 确实需要改代码时, 写进回执, 由编排会话另发实现工单.";

/**
 * 编排会话写业务文件时的拒绝理由.
 * @type {string}
 */
const ORCHESTRATOR_REASON =
  "编排会话只写 .navigator/ 下的编排记录, 不写业务代码与项目配置; 需要改动时发布工单, 交给执行子代理.";

/**
 * @typedef {object} WriteRequest 一次写入的判定输入.
 * @property {string} projectRoot 项目根目录.
 * @property {Record<string, any>} toolInput 工具参数.
 * @property {boolean} isSubagent 调用是否来自子代理.
 * @property {string | undefined} agentType 子代理类型.
 * @property {import("./state.mjs").OrderState | null} order 当前工单.
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
  if (request.agentType === SUBAGENT_TYPES.executor) {
    return decideExecutorWrite(relativePath, request.order);
  }
  if (request.isSubagent) {
    return allow();
  }
  if (
    !isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY) &&
    request.isOrchestrator()
  ) {
    return deny(ORCHESTRATOR_REASON);
  }
  return allow();
}

/**
 * 判定执行子代理的写入: `.navigator/` 下只能写当前工单的回执与证据文件;
 * 业务文件要求工单在执行中, 且不是只产出记录的工单.
 *
 * @param {string} relativePath 目标的项目相对路径.
 * @param {import("./state.mjs").OrderState | null} order 当前工单.
 * @returns {GuardDecision} 判定结果.
 */
function decideExecutorWrite(relativePath, order) {
  if (isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY)) {
    const isOwnRecord =
      order !== null &&
      (relativePathsEqual(
        relativePath,
        orderFilePath(order.folder, "receipt"),
      ) ||
        isUnderDirectory(relativePath, orderArtifactsPath(order.folder)));
    return isOwnRecord ? allow() : deny(EXECUTOR_RECORD_REASON);
  }
  if (order === null || order.status !== ISSUED_ORDER_STATUS) {
    return deny(EXECUTOR_INACTIVE_REASON);
  }
  return isRecordOnlyOrderKind(order.kind)
    ? deny(EXECUTOR_RECORD_ONLY_REASON)
    : allow();
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
