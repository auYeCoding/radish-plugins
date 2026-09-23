/**
 * @file 在项目配置中合并与移除本技能的条目.
 *
 * 两类条目:
 * - hook 条目写入 `.claude/settings.json`, 随仓库入库, 换机器克隆后防护照样生效.
 * - 放行规则同时写入 `.claude/settings.json` 与本机的 `.claude/settings.local.json`.
 *   入库的那份随仓库走, 但要等用户接受工作区信任对话框后才生效, 无头模式永远
 *   不生效; 未入库的本地那份不受这一限制, 初始化后立即生效. 放行规则的作用是:
 *   技能的 `allowed-tools` 只在调用技能的那一轮有效, 之后运行插件命令与写入
 *   记录文件在默认权限模式下都会要求批准. 放行只免去确认, 谁能写哪个文件仍由
 *   守卫决定.
 *
 * 只增删本技能自己的条目, 用户已有的配置原样保留; 重复合并不会产生重复条目.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  HOOK_ENTRY_ARGUMENT,
  NAVIGATOR_DIRECTORY,
  PROJECT_COMMAND_PATH,
} from "./paths.mjs";

/**
 * 放行规则: 项目内命令脚本 (两种 shell 各一条), 以及状态目录中的文件写入.
 * 文件写入规则按 Claude Code 的约定也覆盖 Write 工具, 路径相对于会话的工作目录.
 * @type {readonly string[]}
 */
export const NAVIGATOR_PERMISSION_RULES = Object.freeze([
  `Bash(node ${PROJECT_COMMAND_PATH} *)`,
  `PowerShell(node ${PROJECT_COMMAND_PATH} *)`,
  `Edit(${NAVIGATOR_DIRECTORY}/**)`,
]);

/**
 * hook 命令的超时秒数. 守卫只做本地文件判断, 30 秒足够且能避免卡住会话.
 * @type {number}
 */
const HOOK_TIMEOUT_SECONDS = 30;

/**
 * 需要安装的事件及其匹配器; 匹配器为 undefined 表示该事件不使用匹配器.
 * @type {readonly {event: string, matcher?: string}[]}
 */
const HOOK_EVENTS = Object.freeze([
  { event: "PreToolUse", matcher: "*" },
  { event: "PostToolUse", matcher: "*" },
  { event: "UserPromptSubmit" },
  { event: "SessionStart" },
  { event: "Stop" },
]);

/**
 * 读取项目中的某个配置文件; 文件不存在时返回空对象.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} relativeFile 配置文件相对于项目根目录的路径.
 * @returns {Record<string, any>} 配置对象.
 * @throws {Error} 文件不是合法 JSON 时.
 */
export function readSettingsFile(projectRoot, relativeFile) {
  const file = path.join(projectRoot, relativeFile);
  if (!existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`settings: ${relativeFile} 不是合法的 JSON`, {
      cause: error,
    });
  }
}

/**
 * 写入项目中的某个配置文件, 使用 2 空格缩进并以换行结尾.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} relativeFile 配置文件相对于项目根目录的路径.
 * @param {Record<string, any>} settings 配置对象.
 * @returns {void}
 */
export function writeSettingsFile(projectRoot, relativeFile, settings) {
  const file = path.join(projectRoot, relativeFile);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * 返回合并了本技能 hook 的新配置, 不修改传入对象.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function mergeNavigatorHooks(settings) {
  const hooks = { ...(settings.hooks ?? {}) };
  for (const { event, matcher } of HOOK_EVENTS) {
    const groups = [...(hooks[event] ?? [])];
    if (!groups.some((group) => groupHasNavigatorHook(group))) {
      groups.push(
        matcher === undefined
          ? { hooks: [navigatorHookCommand()] }
          : { matcher, hooks: [navigatorHookCommand()] },
      );
    }
    hooks[event] = groups;
  }
  return { ...settings, hooks };
}

/**
 * 返回移除了本技能 hook 的新配置, 不修改传入对象. 移除后为空的分组, 事件与
 * `hooks` 字段一并删除.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function removeNavigatorHooks(settings) {
  const kept = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const remaining = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) => !isNavigatorHook(hook)),
      }))
      .filter((group) => group.hooks.length > 0);
    if (remaining.length > 0) {
      kept[event] = remaining;
    }
  }
  return replaceField(settings, "hooks", kept);
}

/**
 * 返回合并了本技能放行规则的新配置, 不修改传入对象.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function mergeNavigatorPermissions(settings) {
  const allow = [...(settings.permissions?.allow ?? [])];
  for (const rule of NAVIGATOR_PERMISSION_RULES) {
    if (!allow.includes(rule)) {
      allow.push(rule);
    }
  }
  return {
    ...settings,
    permissions: { ...(settings.permissions ?? {}), allow },
  };
}

/**
 * 返回移除了本技能放行规则的新配置, 不修改传入对象. 移除后为空的 `allow`
 * 与 `permissions` 字段一并删除.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function removeNavigatorPermissions(settings) {
  if (settings.permissions === undefined) {
    return settings;
  }
  const allow = (settings.permissions.allow ?? []).filter(
    (rule) => !NAVIGATOR_PERMISSION_RULES.includes(rule),
  );
  const permissions = replaceField(settings.permissions, "allow", allow);
  return replaceField(settings, "permissions", permissions);
}

/**
 * 判断配置中是否已安装全部事件的本技能 hook.
 *
 * @param {Record<string, any>} settings 配置对象.
 * @returns {boolean} 全部安装时返回 true.
 */
export function hasAllNavigatorHooks(settings) {
  return HOOK_EVENTS.every(({ event }) =>
    (settings.hooks?.[event] ?? []).some((group) =>
      groupHasNavigatorHook(group),
    ),
  );
}

/**
 * 返回替换了某个字段的新对象; 新值为空对象或空数组时删除该字段.
 *
 * @param {Record<string, any>} source 原对象.
 * @param {string} field 字段名.
 * @param {Record<string, any> | any[]} value 新值.
 * @returns {Record<string, any>} 新对象.
 */
function replaceField(source, field, value) {
  const result = { ...source };
  const isEmpty = Array.isArray(value)
    ? value.length === 0
    : Object.keys(value).length === 0;
  if (isEmpty) {
    delete result[field];
  } else {
    result[field] = value;
  }
  return result;
}

/**
 * 构造本技能的 hook 命令. 使用不经过 shell 的形式, 避开不同 shell 的引号差异.
 *
 * @returns {Record<string, unknown>} hook 命令对象.
 */
function navigatorHookCommand() {
  return {
    type: "command",
    command: "node",
    args: [HOOK_ENTRY_ARGUMENT],
    timeout: HOOK_TIMEOUT_SECONDS,
  };
}

/**
 * 判断一个分组中是否含有本技能的 hook.
 *
 * @param {Record<string, any>} group hook 分组.
 * @returns {boolean} 含有时返回 true.
 */
function groupHasNavigatorHook(group) {
  return (group.hooks ?? []).some((hook) => isNavigatorHook(hook));
}

/**
 * 判断一个 hook 命令是否属于本技能.
 *
 * @param {Record<string, any>} hook hook 命令对象.
 * @returns {boolean} 属于本技能时返回 true.
 */
function isNavigatorHook(hook) {
  return (
    hook.type === "command" &&
    Array.isArray(hook.args) &&
    hook.args[0] === HOOK_ENTRY_ARGUMENT
  );
}
