/**
 * @file init 命令: 初始化项目, 或把 1.0.0 之前初始化的项目升级到新的结构.
 *
 * 初始化写入状态目录, 术语表与放行规则; hook 由插件提供, 不写进项目配置, 也不
 * 需要自检. 写入之前先检查必须入库的路径是否会被项目的忽略规则漏掉.
 *
 * 升级时另外清理旧版本写进项目的内容: 项目配置中的项目级 hook 与旧放行规则,
 * `.navigator/bin/` 下的脚本副本与 `.navigator/guide/`, 运行期登记目录中的会话
 * 登记等文件, 以及快照引用. 已发布但还没有回执的工单撤回为起草中, 重新审阅后
 * 由执行子代理处理. 编排记录全部保留.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkEnvironment } from "../lib/environment.mjs";
import {
  GLOSSARY_FILE,
  LEGACY_BIN_DIRECTORY,
  LEGACY_GUIDE_DIRECTORY,
  LEGACY_REGISTRY_ENTRIES,
  LEGACY_SNAPSHOT_REF,
  NAVIGATOR_DIRECTORY,
  NAVIGATOR_ENTRIES,
  ORDER_ARTIFACTS_DIRECTORY,
  PROJECT_LOCAL_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
  navigatorPath,
  orderFilePath,
  registryDirectory,
} from "../lib/paths.mjs";
import { renderGlossarySeed } from "../lib/render-plan.mjs";
import {
  deleteRef,
  ensureLocallyIgnored,
  findIgnoredPaths,
} from "../lib/repo.mjs";
import {
  mergeNavigatorPermissions,
  readSettingsFile,
  removeLegacyHooks,
  writeSettingsFile,
} from "../lib/settings.mjs";
import { loadSpec } from "../lib/spec.mjs";
import {
  INIT_ACTIVE,
  createInitialState,
  readStateIfValid,
  writeState,
} from "../lib/state.mjs";
import {
  requiredTrackedPaths,
  summarizeIgnoredPaths,
} from "../lib/tracked-paths.mjs";
import { runtimeVersion } from "../lib/version.mjs";
import { recordCommitStep } from "./support.mjs";

/**
 * 状态目录中需要预先创建的空目录.
 * @type {readonly ("plan" | "orders" | "drafts")[]}
 */
const EMPTY_DIRECTORIES = Object.freeze(["plan", "orders", "drafts"]);

/**
 * 发布状态; 升级时没有回执的已发布工单撤回为起草中.
 * @type {string}
 */
const ISSUED_STATUS = "issued";

/**
 * 状态目录内 `.gitignore` 的内容. 先重新纳入各级目录与插件写入的文件类型,
 * 避免项目中 `*.json` 之类的规则漏掉记录; 工单的证据文件类型不固定 (例如脚本,
 * 抓包导出), 整个目录重新纳入. 其它文件 (例如系统与编辑器生成的文件) 仍按项目
 * 规则处理. 最后排除草稿: 草稿只是命令的输入, 不入库. 后写的规则优先.
 * @type {string}
 */
const NAVIGATOR_GITIGNORE = [
  "!*/",
  "!*.md",
  "!*.json",
  "!.gitignore",
  `!${NAVIGATOR_ENTRIES.orders}/*/${ORDER_ARTIFACTS_DIRECTORY}/**`,
  "drafts/",
  "",
].join("\n");

/**
 * 执行 init 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 */
export function runInit({ cwd, now }) {
  const environment = checkEnvironment(cwd);
  if (environment.repositoryRoot === undefined) {
    return [
      "- 设置结果: 未执行",
      "- 版本控制: 当前目录不是 Git 仓库, 请先运行 /waypoint:repo-init",
    ];
  }
  if (!environment.isNodeSupported) {
    return [
      "- 设置结果: 未执行",
      `- 运行环境: Node.js ${environment.nodeVersion} 版本过低, 需要 22 或更高版本`,
    ];
  }
  return installNavigator(environment.repositoryRoot, now);
}

/**
 * 写入状态目录, 术语表与放行规则, 并清理旧版本的内容. 先写入状态目录的
 * `.gitignore` 并检查必须入库的路径, 仍有路径被忽略时不做其它改动.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function installNavigator(projectRoot, now) {
  writeIgnoreFile(projectRoot);
  const ignored = findIgnoredPaths(
    projectRoot,
    requiredTrackedPaths(loadSpec()),
  );
  if (ignored.length > 0) {
    return ignoredPathLines(ignored);
  }
  const version = runtimeVersion();
  const existing = readStateIfValid(projectRoot);
  createDirectories(projectRoot);
  seedGlossary(projectRoot);
  installSettings(projectRoot);
  const removed = removeLegacyContent(projectRoot);
  writeState(
    projectRoot,
    existing === undefined
      ? createInitialState({ skillVersion: version, now })
      : migrateState(projectRoot, existing, version),
    now,
  );
  const commit = recordCommitStep(
    projectRoot,
    existing === undefined ? "初始化" : "升级",
    { includeState: true },
  );
  return [
    `- 设置结果: ${existing === undefined ? "已写入" : "已升级"}`,
    `- 状态目录: ${NAVIGATOR_DIRECTORY}/`,
    `- 放行规则: 已合并进 ${PROJECT_SETTINGS_FILE}, 另存一份到本机的 ${PROJECT_LOCAL_SETTINGS_FILE}`,
    ...(removed.length === 0 ? [] : [`- 清理旧版本: ${removed.join(", ")}`]),
    `- 技能版本: ${version}`,
    `- 下一动作: ${commit === undefined ? "" : `${commit}; 然后`}运行 status, 按其中的下一动作继续`,
  ];
}

/**
 * 升级已有状态: 更新技能版本, 恢复为已初始化; 已发布但还没有回执的工单撤回为
 * 起草中, 重新审阅后由执行子代理处理.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 已有状态.
 * @param {string} version 技能版本.
 * @returns {import("../lib/state.mjs").NavigatorState} 升级后的状态.
 */
function migrateState(projectRoot, state, version) {
  const order = state.order;
  const isWaitingIssued =
    order !== null &&
    order.status === ISSUED_STATUS &&
    !existsSync(path.join(projectRoot, orderFilePath(order.folder, "receipt")));
  return {
    ...state,
    skillVersion: version,
    init: { ...state.init, status: INIT_ACTIVE },
    order: isWaitingIssued ? { ...order, status: "drafting" } : order,
    lastAction: isWaitingIssued
      ? `升级到 ${version}, 工单 ${order.id} 撤回为起草中`
      : `升级到 ${version}`,
  };
}

/**
 * 写入放行规则: 入库的项目配置与本机配置各一份, 项目配置中移除旧版本的
 * 项目级 hook, 并确保本机配置不被纳入版本控制.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function installSettings(projectRoot) {
  writeSettingsFile(
    projectRoot,
    PROJECT_SETTINGS_FILE,
    mergeNavigatorPermissions(
      removeLegacyHooks(readSettingsFile(projectRoot, PROJECT_SETTINGS_FILE)),
    ),
  );
  ensureLocallyIgnored(projectRoot, PROJECT_LOCAL_SETTINGS_FILE);
  writeSettingsFile(
    projectRoot,
    PROJECT_LOCAL_SETTINGS_FILE,
    mergeNavigatorPermissions(
      readSettingsFile(projectRoot, PROJECT_LOCAL_SETTINGS_FILE),
    ),
  );
}

/**
 * 清理旧版本写进项目的内容: 脚本副本, 执行手册副本, 运行期登记中的旧文件,
 * 快照引用.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {string[]} 实际清理掉的项目, 用于输出.
 */
function removeLegacyContent(projectRoot) {
  const directories = [LEGACY_BIN_DIRECTORY, LEGACY_GUIDE_DIRECTORY].filter(
    (directory) => existsSync(path.join(projectRoot, directory)),
  );
  for (const directory of directories) {
    rmSync(path.join(projectRoot, directory), { recursive: true, force: true });
  }
  const registry = registryDirectory(projectRoot);
  const entries = LEGACY_REGISTRY_ENTRIES.filter((entry) =>
    existsSync(path.join(registry, entry)),
  );
  for (const entry of entries) {
    rmSync(path.join(registry, entry), { recursive: true, force: true });
  }
  const isSnapshotRemoved = deleteRef(projectRoot, LEGACY_SNAPSHOT_REF);
  return [
    ...directories.map((directory) => `${directory}/`),
    ...(entries.length === 0 ? [] : ["旧的会话登记与快照记录"]),
    ...(isSnapshotRemoved ? [LEGACY_SNAPSHOT_REF] : []),
  ];
}

/**
 * 术语表不存在时写入流程术语; 已有的术语表保留原样.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function seedGlossary(projectRoot) {
  const file = path.join(projectRoot, GLOSSARY_FILE);
  if (!existsSync(file)) {
    writeFileSync(file, renderGlossarySeed(loadSpec()), "utf8");
  }
}

/**
 * 生成必须入库的路径被忽略时的输出: 按忽略规则分组, 写明影响的路径数与一个例子.
 *
 * @param {import("../lib/repo.mjs").IgnoredPath[]} ignored 被忽略的路径.
 * @returns {string[]} 输出各行.
 */
function ignoredPathLines(ignored) {
  return [
    "- 设置结果: 未执行, 编排记录或项目配置会被 Git 忽略, 无法入库",
    ...summarizeIgnoredPaths(ignored).map(
      (summary) => `- 忽略规则: ${summary}`,
    ),
    "- 处理办法: 修改上面的忽略规则, 让这些文件能够入库, 然后重新运行 init",
  ];
}

/**
 * 创建状态目录并写入其 `.gitignore`; 每次初始化与升级都重写.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function writeIgnoreFile(projectRoot) {
  mkdirSync(navigatorPath(projectRoot), { recursive: true });
  writeFileSync(
    navigatorPath(projectRoot, "ignoreFile"),
    NAVIGATOR_GITIGNORE,
    "utf8",
  );
}

/**
 * 创建状态目录中的空子目录.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function createDirectories(projectRoot) {
  for (const entry of EMPTY_DIRECTORIES) {
    mkdirSync(navigatorPath(projectRoot, entry), { recursive: true });
  }
}
