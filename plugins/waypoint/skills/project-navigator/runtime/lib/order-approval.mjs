/**
 * @file 工单审阅: 发布工单之前, 用户在 "工单审阅" 中看过工单内容并选 A.
 *
 * hook 在编排会话回复 "工单审阅" 时记下当时工单文件的摘要, 在用户回答时记下
 * 选择; `order set issued` 只接受摘要与当前工单文件一致的认可. 认可在发布时
 * 用掉, 每次发布 (含受阻或撤回后重新发布) 都要重新审阅. 审阅记录存在运行期
 * 登记目录中, hook 不写状态文件.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isChoiceSelected } from "./option-answer.mjs";
import { orderFilePath } from "./paths.mjs";
import {
  readOrderApproval,
  removeOrderApproval,
  writeOrderApproval,
} from "./registry.mjs";

/**
 * 请用户审阅工单的回复类型.
 * @type {string}
 */
export const APPROVAL_REPLY_TYPE = "工单审阅";

/**
 * "工单审阅" 中表示 "内容无误, 发布工单." 的选项位置: 第 1 组第 1 项.
 * @type {Readonly<{optionSet: number, choice: number}>}
 */
const APPROVE_CHOICE = Object.freeze({ optionSet: 0, choice: 0 });

/**
 * 审阅状态: 用户已认可当前内容, 正在等用户选择, 没有有效的审阅.
 * @type {Readonly<{approved: string, awaiting: string, none: string}>}
 */
export const APPROVAL_STATUSES = Object.freeze({
  approved: "approved",
  awaiting: "awaiting",
  none: "none",
});

/**
 * 计算工单文件内容的摘要; 统一换行符, 避免编辑器的换行差异让认可失效.
 *
 * @param {string} text 工单文件内容.
 * @returns {string} 十六进制的 SHA-256 摘要.
 */
export function digestOrderText(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/gu, "\n"))
    .digest("hex");
}

/**
 * 读取当前工单文件的内容.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{folder: string}} order 当前工单.
 * @returns {string | undefined} 内容; 文件不存在时为 undefined.
 */
export function readOrderText(projectRoot, order) {
  const file = path.join(projectRoot, orderFilePath(order.folder, "order"));
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * 判断当前工单的审阅状态: 审阅记录必须针对这张工单, 且摘要与当前文件一致.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{id: string, folder: string}} order 当前工单.
 * @returns {string} APPROVAL_STATUSES 中的一个值.
 */
export function readApprovalStatus(projectRoot, order) {
  const record = readOrderApproval(projectRoot);
  const text = readOrderText(projectRoot, order);
  if (
    record === undefined ||
    text === undefined ||
    record.order !== order.id ||
    record.digest !== digestOrderText(text)
  ) {
    return APPROVAL_STATUSES.none;
  }
  return record.status === APPROVAL_STATUSES.approved
    ? APPROVAL_STATUSES.approved
    : APPROVAL_STATUSES.awaiting;
}

/**
 * 编排会话回复 "工单审阅" 之后, 记下当时的工单内容, 等待用户选择.
 * 工单文件不存在时清除审阅记录.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {{id: string, folder: string}} order 当前工单.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {void}
 */
export function markAwaitingApproval(projectRoot, order, now) {
  const text = readOrderText(projectRoot, order);
  if (text === undefined) {
    removeOrderApproval(projectRoot);
    return;
  }
  writeOrderApproval(projectRoot, {
    order: order.id,
    digest: digestOrderText(text),
    status: APPROVAL_STATUSES.awaiting,
    updatedAt: now,
  });
}

/**
 * 记录用户对 "工单审阅" 的回答: 选 A 时认可审阅时的内容; 其它回答撤销等待,
 * 编排会话按要求修改后要重新回复 "工单审阅". 没有等待中的审阅时不做任何事.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {{id: string} | null} options.order 当前工单.
 * @param {string} options.prompt 用户消息.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {void}
 */
export function applyApprovalAnswer({ projectRoot, order, prompt, spec, now }) {
  const record = readOrderApproval(projectRoot);
  if (
    record === undefined ||
    record.status !== APPROVAL_STATUSES.awaiting ||
    record.order !== order?.id
  ) {
    return;
  }
  const optionSet =
    spec.replies[APPROVAL_REPLY_TYPE].optionSets[APPROVE_CHOICE.optionSet];
  if (isChoiceSelected(prompt, optionSet, APPROVE_CHOICE.choice)) {
    writeOrderApproval(projectRoot, {
      ...record,
      status: APPROVAL_STATUSES.approved,
      updatedAt: now,
    });
  } else {
    removeOrderApproval(projectRoot);
  }
}

/**
 * 工单发布之后用掉审阅记录; 下次发布要重新审阅.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
export function consumeApproval(projectRoot) {
  removeOrderApproval(projectRoot);
}
