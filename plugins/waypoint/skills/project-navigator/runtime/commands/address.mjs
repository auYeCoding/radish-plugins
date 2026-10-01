/**
 * @file address 命令: 登记编排会话的消息地址, 供执行会话消息汇报时查询.
 *
 * 用法: address set --from <草稿>, 草稿格式 {"address": "编排会话 [9ba602]"}.
 * 地址是 ListAgents 输出第一行中本会话的名称与编号, 进程重启或会话分叉后会变,
 * 所以登记在运行期登记目录中, 不写进工单: 已发布的工单不能再改.
 */

import { recordOrchestratorAddress } from "../lib/sessions.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { openProject, readDraftJson } from "./support.mjs";

/**
 * 地址允许的最大字符数; ListAgents 中的会话名称很短, 超出多半是贴错了内容.
 * @type {number}
 */
const MAX_ADDRESS_LENGTH = 80;

/**
 * 地址的形式: 会话名称, 一个空格, 方括号中的编号. 本机可能有多个同名会话,
 * 只有带编号的地址能让执行会话认准编排会话; 只登记名称时同名会话无法区分.
 * @type {RegExp}
 */
const ADDRESS_PATTERN = /^\S.* \[[0-9A-Za-z]+\]$/u;

/**
 * 执行 address 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 用法不对, 草稿不合法, 或还没有编排会话时.
 */
export function runAddress({ positionals, values, cwd, now }) {
  if (positionals[0] !== "set") {
    throw new WorkflowError("address 的用法: address set --from <草稿>.");
  }
  const { projectRoot } = openProject(cwd, { allowAnomaly: true });
  const address = parseAddress(readDraftJson(projectRoot, values.from));
  if (!recordOrchestratorAddress(projectRoot, { address, now })) {
    throw new WorkflowError("还没有编排会话登记, 请先调用技能接管编排.");
  }
  return [`- 执行结果: 登记编排地址 ${address}`];
}

/**
 * 从草稿中取出地址并校验: 单行, 带方括号中的编号, 不超过长度上限.
 *
 * @param {any} draft 草稿内容.
 * @returns {string} 去掉首尾空白的地址.
 * @throws {WorkflowError} 地址不合法时.
 */
function parseAddress(draft) {
  const address =
    typeof draft?.address === "string" ? draft.address.trim() : "";
  if (
    address.includes("\n") ||
    address.length > MAX_ADDRESS_LENGTH ||
    !ADDRESS_PATTERN.test(address)
  ) {
    throw new WorkflowError(
      `草稿的 address 应为 ListAgents 输出第一行中本会话的名称, 含方括号中的编号 (例如 "编排会话 [9ba602]"), 单行, 不超过 ${MAX_ADDRESS_LENGTH} 个字符.`,
    );
  }
  return address;
}
