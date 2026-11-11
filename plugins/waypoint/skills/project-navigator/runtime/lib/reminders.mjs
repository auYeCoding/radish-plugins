/**
 * @file hook 注入给编排会话的提醒文字: 每次收到消息时的位置与要点, 上下文压缩后
 * 重新查询下一动作.
 */

import { COMMAND_NAME } from "./paths.mjs";
import { progressLine } from "./render.mjs";

/**
 * 编排会话每次收到消息时重申的要点.
 * @type {readonly string[]}
 */
const ORCHESTRATOR_POINTS = Object.freeze([
  "不写业务代码, 实现交给执行子代理",
  `回复前运行 ${COMMAND_NAME} reply <编号> 取骨架, 第一行写一句给人看的结论`,
  "需要用户选择时用回复末尾的选项块",
]);

/**
 * 生成编排会话的提醒: 当前位置与要点.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 提醒文字.
 */
export function orchestratorReminder(state, spec) {
  return [
    `[project-navigator] 你是编排会话. ${progressLine(state, spec)}.`,
    `要点: ${ORCHESTRATOR_POINTS.map((point, index) => `${index + 1}. ${point}`).join("; ")}.`,
  ].join("\n");
}

/**
 * 生成上下文压缩后给编排会话的提醒: 在位置与要点之外, 提示重新查询下一动作.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 提醒文字.
 */
export function orchestratorCompactReminder(state, spec) {
  return [
    orchestratorReminder(state, spec),
    `上下文刚被压缩: 先运行 ${COMMAND_NAME} status 查看最后动作与下一动作, 再继续.`,
  ].join("\n");
}
