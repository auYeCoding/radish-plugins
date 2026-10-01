/**
 * @file 核对会话对项目配置文件 `.claude/settings.json` 的改动.
 *
 * 配置文件中有本技能的防护 hook 与放行规则, 以前一律不许会话改动. 但项目自己的
 * hook (例如改完文件后运行代码检查) 也接线在同一个文件里, 工单要求接线时执行
 * 会话无路可走. 这里只接受 `hooks` 字段内的改动, 并要求本技能的分组原样保留:
 * 防护 hook, 放行规则与其它设置仍然只有插件命令能改. 本模块只做判定, 不读写文件.
 */

import { isDeepStrictEqual } from "node:util";

import { selectNavigatorHookGroups } from "./settings.mjs";

/**
 * 配置中存放 hook 的字段名; 会话只能改动这个字段.
 * @type {string}
 */
const HOOKS_FIELD = "hooks";

/**
 * 可以接受的改动范围, 附在每条拒绝理由之后.
 * @type {string}
 */
export const SETTINGS_EDIT_RULE =
  "这个文件只接受接线项目 hook 的改动: 用 Write 或 Edit, 只改 hooks 字段, 新 hook 写成独立的分组, 本技能的分组 (命令为 node, 参数指向 .navigator/bin/runtime/hook.mjs) 与 hooks 之外的字段原样保留. 其它改动请用户手工完成, 不换写法重试.";

/**
 * 找出一次配置改动的问题.
 *
 * @param {string | undefined} previousText 文件当前内容; 文件不存在时为 undefined.
 * @param {string | undefined} nextText 写入后的全文; 无法重建时为 undefined.
 * @returns {string | undefined} 问题说明; 改动可以接受时为 undefined.
 */
export function findSettingsEditProblem(previousText, nextText) {
  const previous = parseSettings(previousText);
  if (previous === undefined) {
    return "当前内容缺失或不是合法的配置, 无法核对改动; 请先让编排会话运行 init 修复防护配置";
  }
  if (nextText === undefined) {
    return "无法确定写入后的内容; 请确认 old_string 与文件内容一致, 或用 Write 写入完整内容";
  }
  const next = parseSettings(nextText);
  if (next === undefined) {
    return "写入后的内容不是合法的 JSON 配置, 或 hooks 字段的结构不对 (应为事件名到分组数组的映射, 每个分组的 hooks 为数组)";
  }
  const changedFields = listChangedFields(previous, next);
  if (changedFields.length > 0) {
    return `改动了 hooks 之外的字段: ${changedFields.join(", ")}`;
  }
  return isDeepStrictEqual(
    selectNavigatorHookGroups(previous),
    selectNavigatorHookGroups(next),
  )
    ? undefined
    : "改动了本技能的 hook 分组";
}

/**
 * 解析配置全文. 只接受顶层为对象, 且 `hooks` 字段 (存在时) 为事件名到分组数组
 * 映射的配置.
 *
 * @param {string | undefined} text 配置全文.
 * @returns {Record<string, any> | undefined} 配置对象; 不合格时为 undefined.
 */
function parseSettings(text) {
  if (text === undefined) {
    return undefined;
  }
  try {
    const settings = JSON.parse(text);
    return isPlainObject(settings) && hasValidHooks(settings)
      ? settings
      : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 判断配置的 `hooks` 字段结构是否合格: 不存在, 或每个事件对应一个分组数组.
 * 结构不合格的配置在取本技能的分组时会出错, 而守卫出错时对执行会话放行.
 *
 * @param {Record<string, any>} settings 配置对象.
 * @returns {boolean} 合格时返回 true.
 */
function hasValidHooks(settings) {
  const hooks = settings[HOOKS_FIELD];
  if (hooks === undefined) {
    return true;
  }
  return (
    isPlainObject(hooks) &&
    Object.values(hooks).every(
      (groups) =>
        Array.isArray(groups) && groups.every((group) => isValidGroup(group)),
    )
  );
}

/**
 * 判断一个 hook 分组的结构是否合格: 是对象, 其 `hooks` 不存在或为对象数组.
 *
 * @param {unknown} group hook 分组.
 * @returns {boolean} 合格时返回 true.
 */
function isValidGroup(group) {
  if (!isPlainObject(group)) {
    return false;
  }
  return (
    group.hooks === undefined ||
    (Array.isArray(group.hooks) &&
      group.hooks.every((hook) => isPlainObject(hook)))
  );
}

/**
 * 列出两份配置中取值不同的顶层字段, 不含 `hooks`.
 *
 * @param {Record<string, any>} previous 改动前的配置.
 * @param {Record<string, any>} next 改动后的配置.
 * @returns {string[]} 字段名, 按字母顺序排列.
 */
function listChangedFields(previous, next) {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter(
      (field) =>
        field !== HOOKS_FIELD &&
        !isDeepStrictEqual(previous[field], next[field]),
    )
    .sort();
}

/**
 * 判断一个值是否为普通对象 (不是数组, 也不是 null).
 *
 * @param {unknown} value 待判断的值.
 * @returns {boolean} 是普通对象时返回 true.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
