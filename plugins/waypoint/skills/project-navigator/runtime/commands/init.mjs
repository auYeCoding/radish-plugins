/**
 * @file init 命令: 初始化项目, 或把旧版本的记录归档后重新初始化.
 *
 * 初始化写入状态目录与放行规则; hook 由插件提供, 不写进项目配置. 写入之前先检查
 * 必须入库的路径是否会被项目的忽略规则漏掉.
 *
 * 2.0.0 不读取更早版本的记录, 也不迁移: 发现旧记录时停下, 用户同意后用
 * `init --archive` 把旧的状态目录整个改名, 不删除任何内容.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkEnvironment } from "../lib/environment.mjs";
import {
  ARCHIVE_DIRECTORY,
  COMMAND_NAME,
  DRAFTS_DIRECTORY,
  FINDINGS_DIRECTORY,
  NAVIGATOR_DIRECTORY,
  NAVIGATOR_IGNORE_FILE,
  PROJECT_LOCAL_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
  REQUIRED_TRACKED_PATHS,
  SLICES_DIRECTORY,
  STATE_FILE,
} from "../lib/paths.mjs";
import {
  ensureLocallyIgnored,
  findIgnoredPaths,
  summarizeIgnoredPaths,
} from "../lib/repo.mjs";
import {
  mergeNavigatorPermissions,
  readSettingsFile,
  writeSettingsFile,
} from "../lib/settings.mjs";
import {
  INIT_ACTIVE,
  createInitialState,
  isCurrentState,
  readRawState,
} from "../lib/state.mjs";
import { runtimeVersion } from "../lib/version.mjs";
import { productsCommitStep, saveState } from "./support.mjs";

/**
 * 状态目录中需要预先创建的目录, 相对于项目根目录.
 * @type {readonly string[]}
 */
const EMPTY_DIRECTORIES = Object.freeze([
  SLICES_DIRECTORY,
  FINDINGS_DIRECTORY,
  DRAFTS_DIRECTORY,
]);

/**
 * 状态目录内 `.gitignore` 的内容. 先重新纳入各级目录与插件写入的文件类型, 避免
 * 项目中 `*.json` 之类的规则漏掉记录; 结论目录中的文件类型不固定 (例如脚本,
 * 抓包导出), 整个目录重新纳入. 最后排除草稿: 草稿只是命令的输入, 不入库.
 * 后写的规则优先.
 * @type {string}
 */
const NAVIGATOR_GITIGNORE = [
  "!*/",
  "!*.md",
  "!*.json",
  "!.gitignore",
  `!${path.posix.basename(FINDINGS_DIRECTORY)}/**`,
  `${path.posix.basename(DRAFTS_DIRECTORY)}/`,
  "",
].join("\n");

/**
 * 执行 init 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @param {Record<string, any>} options.values 选项值; archive 为 true 时先归档旧记录.
 * @returns {string[]} 输出各行.
 */
export function runInit({ cwd, now, values }) {
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
  const projectRoot = environment.repositoryRoot;
  const hasStateFile = existsSync(path.join(projectRoot, STATE_FILE));
  const raw = readRawState(projectRoot);
  if (hasStateFile && !isCurrentState(raw)) {
    return values.archive === true
      ? archiveAndInstall(projectRoot, now)
      : legacyLines(raw);
  }
  if (values.archive === true) {
    return [
      "- 设置结果: 未执行",
      `- 归档: ${NAVIGATOR_DIRECTORY}/ 中没有旧版本的记录, 不需要 --archive`,
    ];
  }
  return installNavigator(projectRoot, now, []);
}

/**
 * 把旧版本的状态目录改名归档, 再初始化.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function archiveAndInstall(projectRoot, now) {
  const target = path.join(projectRoot, ARCHIVE_DIRECTORY);
  if (existsSync(target)) {
    return [
      "- 设置结果: 未执行",
      `- 归档: ${ARCHIVE_DIRECTORY}/ 已经存在, 请用户先把它移走或改名`,
    ];
  }
  renameSync(path.join(projectRoot, NAVIGATOR_DIRECTORY), target);
  return installNavigator(projectRoot, now, [ARCHIVE_DIRECTORY]);
}

/**
 * 写入状态目录与放行规则. 先写入状态目录的 `.gitignore` 并检查必须入库的路径,
 * 仍有路径被忽略时不做其它改动.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} now 当前时间.
 * @param {readonly string[]} archived 本次归档出的目录, 相对于项目根目录.
 * @returns {string[]} 输出各行.
 */
function installNavigator(projectRoot, now, archived) {
  mkdirSync(path.join(projectRoot, NAVIGATOR_DIRECTORY), { recursive: true });
  writeFileSync(
    path.join(projectRoot, NAVIGATOR_IGNORE_FILE),
    NAVIGATOR_GITIGNORE,
    "utf8",
  );
  const ignored = findIgnoredPaths(projectRoot, REQUIRED_TRACKED_PATHS);
  if (ignored.length > 0) {
    return [
      "- 设置结果: 未执行, 编排记录或项目配置会被 Git 忽略, 无法入库",
      ...summarizeIgnoredPaths(ignored).map(
        (summary) => `- 忽略规则: ${summary}`,
      ),
      "- 处理办法: 修改上面的忽略规则, 让这些文件能够入库, 然后重新运行 init",
    ];
  }
  for (const directory of EMPTY_DIRECTORIES) {
    mkdirSync(path.join(projectRoot, directory), { recursive: true });
  }
  installSettings(projectRoot);
  const version = runtimeVersion();
  const existing = readRawState(projectRoot);
  saveState(
    projectRoot,
    isCurrentState(existing)
      ? {
          ...existing,
          init: { ...existing.init, status: INIT_ACTIVE },
          lastAction: "重新初始化",
        }
      : createInitialState({ skillVersion: version, now }),
    now,
  );
  const commit = productsCommitStep(projectRoot, "初始化", {
    includeState: true,
    extraPathspecs: archived,
  });
  return [
    "- 设置结果: 已写入",
    `- 状态目录: ${NAVIGATOR_DIRECTORY}/`,
    ...archived.map(
      (directory) => `- 归档: 旧记录已改名为 ${directory}/, 内容没有改动`,
    ),
    `- 放行规则: 已合并进 ${PROJECT_SETTINGS_FILE}, 另存一份到本机的 ${PROJECT_LOCAL_SETTINGS_FILE}`,
    `- 技能版本: ${version}`,
    `- 下一动作: ${commit === undefined ? "" : `${commit}; 然后`}运行 \`${COMMAND_NAME} status\`, 按其中的下一动作继续`,
  ];
}

/**
 * 写入放行规则: 入库的项目配置与本机配置各一份, 并确保本机配置不被纳入版本控制.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function installSettings(projectRoot) {
  for (const file of [PROJECT_SETTINGS_FILE, PROJECT_LOCAL_SETTINGS_FILE]) {
    writeSettingsFile(
      projectRoot,
      file,
      mergeNavigatorPermissions(readSettingsFile(projectRoot, file)),
    );
  }
  ensureLocallyIgnored(projectRoot, PROJECT_LOCAL_SETTINGS_FILE);
}

/**
 * 生成发现旧版本记录时的输出.
 *
 * @param {Record<string, any> | undefined} raw 旧的状态文件内容; 文件损坏时为 undefined.
 * @returns {string[]} 输出各行.
 */
function legacyLines(raw) {
  return [
    "- 设置结果: 未执行",
    raw === undefined
      ? `- 旧版记录: ${STATE_FILE} 不是合法的 JSON`
      : `- 旧版记录: ${NAVIGATOR_DIRECTORY}/ 由版本 ${raw.skillVersion ?? "未知"} 写入, 本版本不读取, 也不迁移`,
    `- 处理办法: 用户同意后运行 \`${COMMAND_NAME} init --archive\`, 把 ${NAVIGATOR_DIRECTORY}/ 改名为 ${ARCHIVE_DIRECTORY}/ (只改名, 不删除), 然后重新立项; 状态文件损坏而不想归档时, 先用 git 恢复它`,
  ];
}
