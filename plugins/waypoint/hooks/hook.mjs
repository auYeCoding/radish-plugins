/**
 * @file waypoint 插件级 hook 的统一入口, 由 `hooks/hooks.json` 以 `node <本文件>`
 * 调用, 从标准输入读取事件 JSON. 只为自迭代机制服务: 只观察与注入, 不拒绝任何工具
 * 调用, 以便与 project-navigator 的守卫 hook, 其它插件和用户的全局 hook 共存.
 *
 * - 工具调用后 (matcher 限定 Skill 工具): 若调用的是会自迭代的 waypoint 简单技能
 *   (commit-message, repo-init), 记一个会话级信号 (写在临时目录, 不碰用户项目).
 * - 用户发消息: 只有当本会话用过上述技能且这条消息像一次纠正时, 才注入一行提示,
 *   建议把事实记成缺陷记录供 `/waypoint:review`. 平时完全静默.
 *
 * 不处理 project-navigator: 它有自己的编排流程与记录机制, 其技能缺陷靠用户显式
 * `/waypoint:review` 记录, 避免在编排会话里弹提示.
 *
 * 门控: 没有会话信号或消息不像纠正时不输出. 子代理 (只读) 里不动作.
 * 失败策略: 任何错误都静默放行, 从不以退出码 2 结束, 不拒绝工具调用.
 */

import { readFileSync } from "node:fs";

import { markSkillUsed, wasSkillUsed } from "../runtime/lib/defect-signal.mjs";
import { looksLikeCorrection } from "../runtime/lib/self-iteration.mjs";

/**
 * 被纠正时注入的缺陷记录提示. 只提示记事实, 不让代理下根因结论.
 * @type {string}
 */
const DEFECT_PROMPT =
  '[waypoint] 上一步似乎被纠正了. 若与某个 waypoint 技能 (提交消息 commit-message 或 repo-init) 的结果有关, 往 .waypoint/defects/ 追加一条缺陷记录 (一个 JSON 文件), 只写事实: {"plugin":"waypoint","skill":"","rule":"","patternKey":"","sawWhat":"","didWhat":"","result":"","task":"","at":""}; 不要判断是规则错还是自己错, 归因留给 /waypoint:review. 与 waypoint 技能无关就忽略本提示.';

/**
 * 判断一个技能名是否属于会自迭代的 waypoint 简单技能.
 *
 * @param {string} skill 技能名, 可能带 `waypoint:` 前缀.
 * @returns {boolean} 是 commit-message 或 repo-init 时返回 true.
 */
function isSelfIterableSkill(skill) {
  return /(^|:)(commit-message|repo-init)$/u.test(skill);
}

/**
 * 从工具参数里取技能名.
 *
 * @param {unknown} toolInput 工具参数.
 * @returns {string} 技能名; 取不到时为空串.
 */
function toolSkill(toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) {
    return "";
  }
  const skill = /** @type {Record<string, unknown>} */ (toolInput).skill;
  return typeof skill === "string" ? skill : "";
}

/**
 * 读取事件, 门控, 分发处理, 输出结果.
 *
 * @returns {void}
 */
function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  try {
    if (typeof input.agent_id === "string") {
      return;
    }
    const output = handleEvent(input);
    if (output !== undefined) {
      process.stdout.write(JSON.stringify(output));
    }
  } catch {
    // 失败放行: 不因插件自身问题打断用户的会话.
  }
}

/**
 * 按事件分发.
 *
 * @param {Record<string, any>} input hook 输入.
 * @returns {Record<string, unknown> | undefined} 要输出的 JSON; 不输出时为 undefined.
 */
function handleEvent(input) {
  const sessionId = String(input.session_id ?? "");
  switch (String(input.hook_event_name ?? "")) {
    case "PostToolUse":
      recordSkillUse(input, sessionId);
      return undefined;
    case "UserPromptSubmit":
      if (
        sessionId !== "" &&
        wasSkillUsed(sessionId) &&
        looksLikeCorrection(String(input.prompt ?? ""))
      ) {
        return contextOutput("UserPromptSubmit", DEFECT_PROMPT);
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * 若本次 Skill 调用是会自迭代的 waypoint 简单技能, 记会话信号.
 *
 * @param {Record<string, any>} input hook 输入.
 * @param {string} sessionId 会话 id.
 * @returns {void}
 */
function recordSkillUse(input, sessionId) {
  if (String(input.tool_name ?? "") !== "Skill" || sessionId === "") {
    return;
  }
  const skill = toolSkill(input.tool_input);
  if (isSelfIterableSkill(skill)) {
    markSkillUsed(sessionId);
  }
}

/**
 * 构造注入上下文的输出.
 *
 * @param {string} eventName 事件名.
 * @param {string} text 注入的文字.
 * @returns {Record<string, unknown>} hook 输出 JSON.
 */
function contextOutput(eventName, text) {
  return {
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  };
}

main();
