/**
 * @file 在项目配置中合并与移除本技能的放行规则, 并清理 1.0.0 之前的项目级 hook.
 *
 * hook 由插件的 `hooks/hooks.json` 提供, 不写进项目配置. 项目配置中只放放行规则,
 * 同时写入 `.claude/settings.json` 与本机的 `.claude/settings.local.json`: 入库的
 * 那份随仓库走, 但要等用户接受工作区信任对话框后才生效, 无头模式永远不生效;
 * 本机那份不受这一限制, 初始化后立即生效. 放行规则的作用是: 技能的
 * `allowed-tools` 只在调用技能的那一轮有效, 之后运行插件命令与写入记录文件在
 * 默认权限模式下都会要求批准.
 *
 * 只增删本技能自己的条目, 用户已有的配置原样保留; 重复合并不会产生重复条目.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  COMMAND_NAME,
  LEGACY_COMMAND_PATH,
  LEGACY_HOOK_ENTRY_ARGUMENT,
  NAVIGATOR_DIRECTORY,
} from "./paths.mjs";

/**
 * 放行规则: 插件命令 (两种 shell 各一条), 以及状态目录中的文件写入.
 * 文件写入规则按 Claude Code 的约定也覆盖 Write 工具, 路径相对于会话的工作目录.
 * @type {readonly string[]}
 */
export const NAVIGATOR_PERMISSION_RULES = Object.freeze([
  `Bash(${COMMAND_NAME} *)`,
  `PowerShell(${COMMAND_NAME} *)`,
  `Edit(${NAVIGATOR_DIRECTORY}/**)`,
]);

/**
 * 1.0.0 之前写入的放行规则, 升级与卸载时移除.
 * @type {readonly string[]}
 */
const LEGACY_PERMISSION_RULES = Object.freeze([
  `Bash(node ${LEGACY_COMMAND_PATH} *)`,
  `PowerShell(node ${LEGACY_COMMAND_PATH} *)`,
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
 * 返回合并了本技能放行规则的新配置, 同时去掉 1.0.0 之前的放行规则,
 * 不修改传入对象.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function mergeNavigatorPermissions(settings) {
  const allow = (settings.permissions?.allow ?? []).filter(
    (rule) => !LEGACY_PERMISSION_RULES.includes(rule),
  );
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
 * 返回移除了本技能放行规则 (含 1.0.0 之前的规则) 的新配置, 不修改传入对象.
 * 移除后为空的 `allow` 与 `permissions` 字段一并删除.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function removeNavigatorPermissions(settings) {
  if (settings.permissions === undefined) {
    return settings;
  }
  const allow = (settings.permissions.allow ?? []).filter(
    (rule) =>
      !NAVIGATOR_PERMISSION_RULES.includes(rule) &&
      !LEGACY_PERMISSION_RULES.includes(rule),
  );
  const permissions = replaceField(settings.permissions, "allow", allow);
  return replaceField(settings, "permissions", permissions);
}

/**
 * 判断配置中是否还有 1.0.0 之前写入的项目级 hook.
 *
 * @param {Record<string, any>} settings 配置对象.
 * @returns {boolean} 有时返回 true.
 */
export function hasLegacyHooks(settings) {
  return Object.values(settings.hooks ?? {}).some((groups) =>
    groups.some((group) => (group.hooks ?? []).some(isLegacyHook)),
  );
}

/**
 * 返回移除了 1.0.0 之前项目级 hook 的新配置, 不修改传入对象. 移除后为空的
 * 分组, 事件与 `hooks` 字段一并删除.
 *
 * @param {Record<string, any>} settings 原配置.
 * @returns {Record<string, any>} 新配置.
 */
export function removeLegacyHooks(settings) {
  const kept = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const remaining = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) => !isLegacyHook(hook)),
      }))
      .filter((group) => group.hooks.length > 0);
    if (remaining.length > 0) {
      kept[event] = remaining;
    }
  }
  return replaceField(settings, "hooks", kept);
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
 * 判断一个 hook 命令是否是 1.0.0 之前写入的项目级 hook.
 *
 * @param {Record<string, any>} hook hook 命令对象.
 * @returns {boolean} 是时返回 true.
 */
function isLegacyHook(hook) {
  return (
    hook.type === "command" &&
    Array.isArray(hook.args) &&
    hook.args[0] === LEGACY_HOOK_ENTRY_ARGUMENT
  );
}
