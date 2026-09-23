/**
 * @file hook 注入给会话的提醒文字: 编排会话每次收到消息与上下文压缩后的位置与禁令,
 * 执行会话的身份与对齐状态.
 */

import {
  EXECUTOR_GUIDE_FILE,
  PROJECT_COMMAND_PATH,
  orderFilePath,
} from "./paths.mjs";
import { progressValues } from "./render.mjs";

/**
 * 编排会话每次收到消息时重申的三条禁令.
 * @type {readonly string[]}
 */
const ORCHESTRATOR_RULES = Object.freeze([
  "不写业务代码, 不贴代码, 不做技术选型, 这些交给执行会话",
  "不替用户做决定, 需要用户选择时用回复末尾的选项块",
  "每次回复先运行 reply 命令取得填写要求与骨架, 按要求填写",
]);

/**
 * 生成编排会话的提醒: 当前位置与三条禁令.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 提醒文字.
 */
export function orchestratorReminder(state, spec) {
  const values = progressValues(state, spec);
  const position = spec.format.progressKeys
    .map((key, index) => `${key} ${values[index]}`)
    .join(", ");
  return [
    `[project-navigator] 你是编排会话. ${position}.`,
    `禁令: ${ORCHESTRATOR_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("; ")}.`,
  ].join("\n");
}

/**
 * 生成上下文压缩后给编排会话的提醒: 在位置与禁令之外, 提示重新查询下一动作.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 提醒文字.
 */
export function orchestratorResumeReminder(state, spec) {
  return [
    orchestratorReminder(state, spec),
    `上下文刚被压缩: 先运行 node ${PROJECT_COMMAND_PATH} status 查看最后动作与下一动作, 再继续.`,
  ].join("\n");
}

/**
 * 生成执行会话的提醒: 绑定的工单, 手册位置与对齐状态.
 *
 * @param {import("./registry.mjs").ExecutorRecord} record 执行登记.
 * @returns {string} 提醒文字.
 */
export function executorReminder(record) {
  const alignment = record.isAligned
    ? "已对齐, 可以改动业务文件"
    : '未对齐: 先按 "开工对齐" 版式回复, 用户选 A 之后才能改动业务文件';
  return [
    `[project-navigator] 你是工单 ${record.order} 的执行会话.`,
    `执行手册: ${EXECUTOR_GUIDE_FILE}; 工单: ${orderFilePath(record.folder, "order")}; 对齐状态: ${alignment}.`,
  ].join("\n");
}
