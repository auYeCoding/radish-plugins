/**
 * @file init 命令: 初始化或升级项目, 以及确认自检结果.
 *
 * 初始化分两步: 第一步写入状态目录, 运行脚本副本与 hook 配置, 并发出自检请求;
 * 编排会话随后尝试一次被禁止的写入, 守卫拦下时留下心跳; 第二步 (`--verify`)
 * 核对心跳, 确认 hook 在当前会话中已经生效. 写入之前先检查状态目录中必须入库的
 * 路径是否会被项目的忽略规则漏掉.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkEnvironment } from "../lib/environment.mjs";
import {
  EXECUTOR_GUIDE_FILE,
  GLOSSARY_FILE,
  GUIDE_SOURCE_FILE,
  NAVIGATOR_DIRECTORY,
  PROBE_FILE,
  PROJECT_COMMAND_PATH,
  PROJECT_LOCAL_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
  RUNTIME_COPY_DIRECTORIES,
  RUNTIME_VERSION_FILE,
  SKILL_ROOT,
  navigatorPath,
} from "../lib/paths.mjs";
import { readProbeState, writeProbeRequest } from "../lib/registry.mjs";
import { renderGlossarySeed } from "../lib/render-plan.mjs";
import {
  ensureLocallyIgnored,
  findIgnoredPaths,
  headCommit,
} from "../lib/repo.mjs";
import { claimSession } from "../lib/sessions.mjs";
import {
  mergeNavigatorHooks,
  mergeNavigatorPermissions,
  readSettingsFile,
  writeSettingsFile,
} from "../lib/settings.mjs";
import { takeSnapshot } from "../lib/snapshots.mjs";
import { loadSpec } from "../lib/spec.mjs";
import {
  INIT_ACTIVE,
  INIT_PENDING,
  createInitialState,
  readState,
  writeState,
} from "../lib/state.mjs";
import { requiredTrackedPaths } from "../lib/tracked-paths.mjs";
import { runtimeVersion } from "../lib/version.mjs";

/**
 * 状态目录中需要预先创建的空目录.
 * @type {readonly ("plan" | "orders" | "drafts" | "guide")[]}
 */
const EMPTY_DIRECTORIES = Object.freeze(["plan", "orders", "drafts", "guide"]);

/**
 * 状态目录内 `.gitignore` 的内容. 先重新纳入各级目录与插件写入的文件类型,
 * 避免项目中 `bin/`, `lib/`, `*.json` 之类的规则漏掉运行脚本与记录; 其它文件
 * (例如系统与编辑器生成的文件) 仍按项目规则处理. 最后排除草稿: 草稿只是
 * 命令行脚本的输入, 不入库. 后写的规则优先.
 * @type {string}
 */
const NAVIGATOR_GITIGNORE = [
  "!*/",
  "!*.md",
  "!*.mjs",
  "!*.json",
  "!.gitignore",
  "drafts/",
  "",
].join("\n");

/**
 * 执行 init 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string | undefined} options.sessionId 发起初始化的会话.
 * @param {boolean} options.isVerify 是否只确认自检结果.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 */
export function runInit({ cwd, sessionId, isVerify, now }) {
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
  return isVerify
    ? verifyProbe(environment.repositoryRoot, now)
    : installNavigator(environment.repositoryRoot, sessionId, now);
}

/**
 * 写入状态目录, 运行脚本副本与 hook 配置, 并发出自检请求. 先写入状态目录的
 * `.gitignore` 并检查必须入库的路径, 仍有路径被忽略时不做其它改动.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string | undefined} sessionId 发起初始化的会话.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function installNavigator(projectRoot, sessionId, now) {
  writeIgnoreFile(projectRoot);
  const ignored = findIgnoredPaths(
    projectRoot,
    requiredTrackedPaths(loadSpec()),
  );
  if (ignored.length > 0) {
    return ignoredPathLines(ignored);
  }
  const version = runtimeVersion();
  const existing = readState(projectRoot);
  createDirectories(projectRoot);
  copyRuntime(projectRoot, version);
  copyExecutorGuide(projectRoot);
  seedGlossary(projectRoot);
  const upgraded =
    existing === undefined
      ? {
          ...createInitialState({ skillVersion: version, sessionId, now }),
          lastCommit: headCommit(projectRoot) ?? null,
        }
      : {
          ...existing,
          skillVersion: version,
          init: { ...existing.init, status: INIT_PENDING },
        };
  const state =
    sessionId === undefined ? upgraded : claimSession(upgraded, sessionId, now);
  writeState(projectRoot, state, now);
  installSettings(projectRoot);
  writeProbeRequest(projectRoot, now);
  return [
    `- 设置结果: ${existing === undefined ? "已写入" : "已升级"}, 等待自检`,
    `- 状态目录: ${NAVIGATOR_DIRECTORY}/`,
    `- 防护配置: hook 与放行规则已合并进 ${PROJECT_SETTINGS_FILE}, 放行规则另存一份到本机的 ${PROJECT_LOCAL_SETTINGS_FILE}`,
    `- 技能版本: ${version}`,
    `- 自检步骤: 用 Write 工具写入 ${path.join(projectRoot, PROBE_FILE)}, 内容任意, 预期被拒绝; 然后运行 node ${PROJECT_COMMAND_PATH} init --verify`,
  ];
}

/**
 * 合并配置: hook 与放行规则写入入库的项目配置, 放行规则另写一份到本机配置,
 * 并确保本机配置不被纳入版本控制.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function installSettings(projectRoot) {
  writeSettingsFile(
    projectRoot,
    PROJECT_SETTINGS_FILE,
    mergeNavigatorPermissions(
      mergeNavigatorHooks(readSettingsFile(projectRoot, PROJECT_SETTINGS_FILE)),
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
 * 核对自检心跳, 通过后把初始化状态改为生效.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 */
function verifyProbe(projectRoot, now) {
  const state = readState(projectRoot);
  if (state === undefined) {
    return ["- 自检结果: 未通过, 尚未初始化, 请先运行 init"];
  }
  const { request, heartbeat } = readProbeState(projectRoot);
  const isProbeFileAbsent = !existsSync(path.join(projectRoot, PROBE_FILE));
  const isHeartbeatFresh =
    request !== undefined &&
    heartbeat !== undefined &&
    heartbeat.deniedAt >= request.requestedAt;
  if (!isHeartbeatFresh || !isProbeFileAbsent) {
    rmSync(path.join(projectRoot, PROBE_FILE), { force: true });
    return [
      "- 自检结果: 未通过, 守卫没有拦下探测写入",
      "- 可能原因: 当前会话尚未加载新的 hook 配置",
      "- 处理办法: 重启 Claude Code 会话后重新调用技能, 再做一次自检",
    ];
  }
  writeState(
    projectRoot,
    { ...state, init: { ...state.init, status: INIT_ACTIVE, verifiedAt: now } },
    now,
  );
  takeSnapshot(projectRoot, { now, head: headCommit(projectRoot) });
  return ["- 自检结果: 通过, 防护已生效"];
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
 * 把技能目录中的执行手册复制进状态目录; 执行会话在仓库内读取这一份.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {void}
 */
function copyExecutorGuide(projectRoot) {
  if (existsSync(GUIDE_SOURCE_FILE)) {
    cpSync(GUIDE_SOURCE_FILE, path.join(projectRoot, EXECUTOR_GUIDE_FILE));
  }
}

/**
 * 生成必须入库的路径被忽略时的输出: 按忽略规则分组, 写明影响的路径数与一个例子.
 *
 * @param {import("../lib/repo.mjs").IgnoredPath[]} ignored 被忽略的路径.
 * @returns {string[]} 输出各行.
 */
function ignoredPathLines(ignored) {
  const groups = Map.groupBy(ignored, (entry) => entry.rule);
  return [
    "- 设置结果: 未执行, 状态目录中有文件会被 Git 忽略, 编排记录与运行脚本无法入库",
    ...[...groups].map(
      ([rule, entries]) =>
        `- 忽略规则: ${rule}, 影响 ${entries.length} 个路径, 例如 ${entries[0].path}`,
    ),
    `- 处理办法: 修改上面的忽略规则, 让 ${NAVIGATOR_DIRECTORY}/ 下的文件能够入库, 然后重新运行 init`,
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

/**
 * 把运行脚本与规格复制进 `.navigator/bin/`, 并写入版本文件.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} version 技能版本.
 * @returns {void}
 */
function copyRuntime(projectRoot, version) {
  const binDirectory = navigatorPath(projectRoot, "bin");
  if (path.resolve(binDirectory) === path.resolve(SKILL_ROOT)) {
    return;
  }
  for (const directory of RUNTIME_COPY_DIRECTORIES) {
    const target = path.join(binDirectory, directory);
    rmSync(target, { recursive: true, force: true });
    cpSync(path.join(SKILL_ROOT, directory), target, { recursive: true });
  }
  writeFileSync(
    path.join(binDirectory, RUNTIME_VERSION_FILE),
    `${JSON.stringify({ version }, null, 2)}\n`,
    "utf8",
  );
}
