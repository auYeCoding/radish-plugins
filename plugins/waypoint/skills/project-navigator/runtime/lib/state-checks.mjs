/**
 * @file 状态自检: 核对状态文件与记录文件是否自洽. 命令只会写出自洽的状态,
 * 所以不自洽说明技能脚本有问题, 或状态被别的途径改过; 两种情况流程都不能照常继续.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { orderFilePath } from "./paths.mjs";
import { lastStageNumber } from "./spec.mjs";
import { ORDER_KINDS, ORDER_TRANSITIONS } from "./workflow-orders.mjs";

/**
 * 工单文件必须已经存在的工单状态: 发布之后的各个状态.
 * @type {readonly string[]}
 */
const STATUSES_WITH_ORDER_FILE = Object.freeze([
  "issued",
  "blocked",
  "reviewing",
]);

/**
 * 核对状态是否自洽, 返回发现的问题.
 *
 * @param {object} options 参数.
 * @param {import("./state.mjs").NavigatorState} options.state 当前状态.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @returns {string[]} 问题列表; 为空表示自洽.
 */
export function checkStateConsistency({ state, projectRoot, spec }) {
  return [
    ...checkPosition(state, lastStageNumber(spec)),
    ...checkOrder(state, projectRoot),
  ];
}

/**
 * 核对阶段, 当前里程与当前切片.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {number} lastStage 最后一个阶段的编号.
 * @returns {string[]} 问题列表.
 */
function checkPosition(state, lastStage) {
  const problems = [];
  const isStageValid =
    state.stage === null ||
    (Number.isInteger(state.stage) &&
      state.stage >= 0 &&
      state.stage <= lastStage);
  if (!isStageValid) {
    problems.push(
      `阶段编号 ${String(state.stage)} 不在 0 至 ${lastStage} 之间.`,
    );
  }
  if (
    state.milestone !== null &&
    !state.milestones.some((entry) => entry.id === state.milestone)
  ) {
    problems.push(`当前里程 ${state.milestone} 不在里程列表中.`);
  }
  if (
    state.slice !== null &&
    !state.slices.some((entry) => entry.id === state.slice)
  ) {
    problems.push(`当前切片 ${state.slice} 不在切片列表中.`);
  }
  return problems;
}

/**
 * 核对当前工单: 类型与状态合法, 所属切片存在, 发布之后工单文件存在.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {string} projectRoot 项目根目录.
 * @returns {string[]} 问题列表.
 */
function checkOrder(state, projectRoot) {
  const order = state.order;
  if (order === null) {
    return [];
  }
  const problems = [];
  if (!ORDER_KINDS.includes(order.kind)) {
    problems.push(`工单 ${order.id} 的类型 ${order.kind} 不是已知的类型.`);
  }
  if (!Object.hasOwn(ORDER_TRANSITIONS, order.status)) {
    problems.push(`工单 ${order.id} 的状态 ${order.status} 不是进行中的状态.`);
  }
  if (
    order.slice !== null &&
    !state.slices.some((entry) => entry.id === order.slice)
  ) {
    problems.push(`工单 ${order.id} 所属的切片 ${order.slice} 不在切片列表中.`);
  }
  const orderFile = orderFilePath(order.folder, "order");
  if (
    STATUSES_WITH_ORDER_FILE.includes(order.status) &&
    !existsSync(path.join(projectRoot, orderFile))
  ) {
    problems.push(
      `工单 ${order.id} 处于 ${order.status}, 但工单文件 ${orderFile} 不存在.`,
    );
  }
  return problems;
}
