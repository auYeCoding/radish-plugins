/**
 * @file 子代理使用的模型: 默认分配, 项目中的改动, 以及派出时的写法.
 *
 * 模型在派出子代理时用 Agent 工具的 `model` 参数指定: 这个参数优先于子代理定义
 * 与环境变量, 用 SendMessage 续接时也保留 (Claude Code 官方文档). 所以分配写在
 * 状态文件中, 由下一动作写出参数, 不写进子代理定义: 定义写死之后所有项目都受
 * 影响, 续接时是否保留也没有文档依据.
 *
 * 默认分配: 照单取证的子代理 (核对, 验收, 阅读, 调研) 用 sonnet; 执行子代理跟随
 * 编排会话, 因为它要设计与判断, 也是指出工单有错的那一方.
 */

import { WorkflowError } from "./workflow-error.mjs";
import { ORDER_KINDS } from "./workflow-orders.mjs";

/**
 * 表示跟随编排会话模型的取值: 派出时不传 `model` 参数.
 * @type {string}
 */
export const INHERIT_MODEL = "inherit";

/**
 * 可以指定的模型: Agent 工具 `model` 参数接受的别名, 以及跟随编排会话.
 * @type {readonly string[]}
 */
export const MODEL_CHOICES = Object.freeze([
  "sonnet",
  "opus",
  "haiku",
  "fable",
  INHERIT_MODEL,
]);

/**
 * 子代理的角色.
 * @type {Readonly<{executor: string, checker: string, reviewer: string, reader: string, researcher: string}>}
 */
export const MODEL_ROLES = Object.freeze({
  executor: "executor",
  checker: "checker",
  reviewer: "reviewer",
  reader: "reader",
  researcher: "researcher",
});

/**
 * 各角色的中文名, 用于输出.
 * @type {Readonly<Record<string, string>>}
 */
const ROLE_LABELS = Object.freeze({
  [MODEL_ROLES.executor]: "执行",
  [MODEL_ROLES.checker]: "核对",
  [MODEL_ROLES.reviewer]: "验收",
  [MODEL_ROLES.reader]: "阅读",
  [MODEL_ROLES.researcher]: "调研",
});

/**
 * 各角色的默认模型.
 * @type {Readonly<Record<string, string>>}
 */
const DEFAULT_MODELS = Object.freeze({
  [MODEL_ROLES.executor]: INHERIT_MODEL,
  [MODEL_ROLES.checker]: "sonnet",
  [MODEL_ROLES.reviewer]: "sonnet",
  [MODEL_ROLES.reader]: "sonnet",
  [MODEL_ROLES.researcher]: "sonnet",
});

/**
 * 按工单类型单独指定执行模型时, 状态中键的分隔符, 例如 "executor:fix".
 * @type {string}
 */
const KIND_SEPARATOR = ":";

/**
 * 取得某个角色使用的模型. 执行子代理先看这种工单类型的指定, 再看执行的指定.
 *
 * @param {Record<string, string> | undefined} models 状态中登记的分配.
 * @param {string} role 角色.
 * @param {string} [kind] 工单类型; 只对执行子代理有意义.
 * @returns {string} MODEL_CHOICES 中的一个值.
 */
export function resolveModel(models, role, kind) {
  const assigned = models ?? {};
  return (
    (kind === undefined
      ? undefined
      : assigned[`${role}${KIND_SEPARATOR}${kind}`]) ??
    assigned[role] ??
    DEFAULT_MODELS[role]
  );
}

/**
 * 写出派出子代理时 `model` 参数的写法.
 *
 * @param {Record<string, string> | undefined} models 状态中登记的分配.
 * @param {string} role 角色.
 * @param {string} [kind] 工单类型.
 * @returns {string} 例如 `model 参数写 "sonnet"`, 或 "不传 model 参数".
 */
export function modelArgument(models, role, kind) {
  const model = resolveModel(models, role, kind);
  return model === INHERIT_MODEL
    ? "不传 model 参数"
    : `model 参数写 "${model}"`;
}

/**
 * 登记某个角色使用的模型, 返回新状态.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {object} options 参数.
 * @param {string} options.role 角色.
 * @param {string} options.model 模型.
 * @param {string} [options.kind] 工单类型; 只能与执行子代理一起用.
 * @returns {import("./state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 角色, 模型或工单类型不合法时.
 */
export function assignModel(state, { role, model, kind }) {
  const roles = Object.values(MODEL_ROLES);
  if (!roles.includes(role)) {
    throw new WorkflowError(`角色应为 ${roles.join(", ")} 之一.`);
  }
  if (!MODEL_CHOICES.includes(model)) {
    throw new WorkflowError(`模型应为 ${MODEL_CHOICES.join(", ")} 之一.`);
  }
  if (kind !== undefined && role !== MODEL_ROLES.executor) {
    throw new WorkflowError("--kind 只能与 executor 一起用.");
  }
  if (kind !== undefined && !ORDER_KINDS.includes(kind)) {
    throw new WorkflowError(`工单类型应为 ${ORDER_KINDS.join(", ")} 之一.`);
  }
  const key = kind === undefined ? role : `${role}${KIND_SEPARATOR}${kind}`;
  return {
    ...state,
    models: { ...state.models, [key]: model },
    lastAction: `子代理模型 ${key} 设为 ${model}`,
  };
}

/**
 * 描述当前的模型分配, 一行写完; 执行子代理按工单类型另有指定时一并列出.
 *
 * @param {Record<string, string> | undefined} models 状态中登记的分配.
 * @returns {string} 例如 "执行 跟随会话, 核对 sonnet, 验收 sonnet".
 */
export function describeModels(models) {
  const label = (model) => (model === INHERIT_MODEL ? "跟随会话" : model);
  const overrides = Object.entries(models ?? {})
    .filter(([key]) => key.includes(KIND_SEPARATOR))
    .map(
      ([key, model]) =>
        `${ROLE_LABELS[MODEL_ROLES.executor]} (${key.split(KIND_SEPARATOR)[1]} 工单) ${label(model)}`,
    );
  return [
    ...Object.values(MODEL_ROLES).map(
      (role) => `${ROLE_LABELS[role]} ${label(resolveModel(models, role))}`,
    ),
    ...overrides,
  ].join(", ");
}
