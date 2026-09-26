/**
 * @file 按会话身份给出的提示文字: 被接管的原编排会话与其它会话被拒绝时, 说明原因
 * 与正确做法. 写入守卫, 命令守卫与 hook 的提醒共用这里的文字.
 */

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
 * 其它会话要参与编排或执行工单时的做法.
 * @type {string}
 */
export const OTHER_SESSION_GUIDE = `要编排, 请用户调用 ${SKILL_COMMAND}; 要执行工单, 在新会话中粘贴工单的启动提示词`;

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
