/**
 * @file 按会话身份给出的提示文字: 被接管的原编排会话与其它会话被拒绝时, 说明原因
 * 与正确做法; 分叉接管与登记编排地址的提醒. 写入守卫, 命令守卫, enter 与 hook
 * 的提醒共用这里的文字.
 */

import { PROJECT_COMMAND_PATH } from "./paths.mjs";

/**
 * 调用本技能的斜杠命令, 含插件名.
 * @type {string}
 */
export const SKILL_COMMAND = "/waypoint:project-navigator";

/**
 * 被接管的原编排会话的身份说明.
 * @type {string}
 */
export const SUPERSEDED_NOTICE = "本会话已不是编排会话: 编排已由另一个会话接管";

/**
 * 被接管的原编排会话要继续编排时的做法.
 * @type {string}
 */
export const RECLAIM_GUIDE = `要在本会话继续编排, 请用户重新调用 ${SKILL_COMMAND} 接管`;

/**
 * 其它会话要参与编排或执行工单时的做法. 原是执行会话, 分叉后没有被认出的会话
 * 也会收到这段话, 所以写明在本会话重新发送启动提示词即可, 不必新开会话.
 * @type {string}
 */
export const OTHER_SESSION_GUIDE = `要编排, 请用户调用 ${SKILL_COMMAND}; 要执行工单, 请用户发送工单的启动提示词 (含 "执行工单 <编号>"), 本会话原是执行会话时在本会话重新发送即可`;

/**
 * 编排会话登记消息地址的做法. 地址是 ListAgents 输出第一行中的本会话名称,
 * 进程重启或会话分叉后会变, 所以每次接管与恢复之后都重新登记.
 * @type {string}
 */
export const ADDRESS_REGISTRATION_STEP = `登记编排地址: 运行 ListAgents, 把输出第一行中本会话的名称 (含方括号中的编号, 例如 "编排会话 [9ba602]") 写成草稿 {"address": "<名称>"}, 再运行 node ${PROJECT_COMMAND_PATH} address set --from <草稿>. 执行会话消息汇报时按这个地址发送`;

/**
 * 生成分叉出的会话自动接管编排后的提醒. 提醒带编排会话标记, 以后从本会话再次
 * 分叉时, hook 据此认出来源.
 *
 * @param {string} marker 本会话的编排会话标记.
 * @returns {string} 提醒文字.
 */
export function forkClaimReminder(marker) {
  return `[project-navigator] 本会话由编排会话分叉而来 (例如回退或编辑了消息), 会话编号已改变, 已自动接管编排. ${marker}. 先${ADDRESS_REGISTRATION_STEP}; 然后运行 node ${PROJECT_COMMAND_PATH} status, 按下一动作继续.`;
}

/**
 * 生成被接管的原编排会话在收到消息或会话开始时的提醒.
 *
 * @param {string | undefined} claimedAt 当前编排会话接管的时间; 不知道时为 undefined.
 * @returns {string} 提醒文字.
 */
export function supersededReminder(claimedAt) {
  const time =
    claimedAt === undefined || claimedAt === ""
      ? ""
      : ` (接管时间 ${claimedAt})`;
  return `[project-navigator] ${SUPERSEDED_NOTICE}${time}. 本会话不能再写 .navigator/ 下的编排记录, 也不能运行改变编排状态的插件命令. ${RECLAIM_GUIDE}.`;
}
