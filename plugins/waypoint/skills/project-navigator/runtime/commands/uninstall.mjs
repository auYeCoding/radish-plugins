/**
 * @file uninstall 命令: 移除本技能的放行规则, 把项目标为已卸载, 保留全部编排记录.
 *
 * hook 由插件提供, 无法按项目移除; 项目标为已卸载后, 插件的 hook 在本项目中
 * 不做任何事.
 */

import {
  COMMAND_NAME,
  PROJECT_LOCAL_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
} from "../lib/paths.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import {
  readSettingsFile,
  removeNavigatorPermissions,
  writeSettingsFile,
} from "../lib/settings.mjs";
import { INIT_UNINSTALLED, readState } from "../lib/state.mjs";
import { saveState } from "./support.mjs";

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
  for (const file of [PROJECT_SETTINGS_FILE, PROJECT_LOCAL_SETTINGS_FILE]) {
    writeSettingsFile(
      projectRoot,
      file,
      removeNavigatorPermissions(readSettingsFile(projectRoot, file)),
    );
  }
  const state = readState(projectRoot);
  if (state !== undefined) {
    saveState(
      projectRoot,
      {
        ...state,
        init: { ...state.init, status: INIT_UNINSTALLED, uninstalledAt: now },
        lastAction: "卸载",
      },
      now,
    );
  }
  return [
    "- 卸载结果: 已移除放行规则, 插件的 hook 在本项目中不再生效",
    `- 编排记录: 已保留, 重新运行 ${COMMAND_NAME} init 可恢复`,
  ];
}
