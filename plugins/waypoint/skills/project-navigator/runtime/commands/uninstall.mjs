/**
 * @file uninstall 命令: 移除本技能的放行规则, 把项目标为已卸载, 保留全部编排记录.
 *
 * hook 由插件提供, 无法按项目移除; 项目标为已卸载后, 插件的 hook 在本项目中
 * 不做任何事.
 */

import {
  PROJECT_LOCAL_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
} from "../lib/paths.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import {
  readSettingsFile,
  removeLegacyHooks,
  removeNavigatorPermissions,
  writeSettingsFile,
} from "../lib/settings.mjs";
import {
  INIT_UNINSTALLED,
  readStateIfValid,
  writeState,
} from "../lib/state.mjs";

/**
 * 执行 uninstall 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 */
export function runUninstall({ cwd, now }) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    return ["- 卸载结果: 未执行, 当前目录不是 Git 仓库"];
  }
  writeSettingsFile(
    projectRoot,
    PROJECT_SETTINGS_FILE,
    removeNavigatorPermissions(
      removeLegacyHooks(readSettingsFile(projectRoot, PROJECT_SETTINGS_FILE)),
    ),
  );
  writeSettingsFile(
    projectRoot,
    PROJECT_LOCAL_SETTINGS_FILE,
    removeNavigatorPermissions(
      readSettingsFile(projectRoot, PROJECT_LOCAL_SETTINGS_FILE),
    ),
  );
  const state = readStateIfValid(projectRoot);
  if (state !== undefined) {
    writeState(
      projectRoot,
      {
        ...state,
        init: { ...state.init, status: INIT_UNINSTALLED, uninstalledAt: now },
      },
      now,
    );
  }
  return [
    "- 卸载结果: 已移除放行规则, 插件的 hook 在本项目中不再生效",
    "- 编排记录: 已保留, 重新运行 init 可恢复",
  ];
}
