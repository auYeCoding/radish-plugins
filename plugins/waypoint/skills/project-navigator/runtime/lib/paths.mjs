/**
 * @file 项目内各类路径与插件命令名的唯一定义, 以及路径归属判断.
 *
 * 运行脚本只在插件目录中运行: 命令经插件 `bin/` 中的 `project-navigator` 调用,
 * hook 由插件的 `hooks/hooks.json` 调用. 所有相对路径都在这里定义, 其它模块不写
 * 路径字面量. 以 LEGACY 开头的常量是 1.0.0 之前写进项目的内容, 只供升级时清理.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 插件命令名: 插件 `bin/` 中的可执行文件, 在 Bash 与 PowerShell 工具的 PATH 中.
 * @type {string}
 */
export const COMMAND_NAME = "project-navigator";

/**
 * 状态目录相对于项目根目录的路径.
 * @type {string}
 */
export const NAVIGATOR_DIRECTORY = ".navigator";

/**
 * 状态目录中各子路径, 相对于状态目录.
 * @type {Readonly<Record<string, string>>}
 */
export const NAVIGATOR_ENTRIES = Object.freeze({
  state: "state.json",
  plan: "plan",
  orders: "orders",
  drafts: "drafts",
  ignoreFile: ".gitignore",
});

/**
 * 状态文件, 相对于项目根目录.
 * @type {string}
 */
export const STATE_FILE = `${NAVIGATOR_DIRECTORY}/${NAVIGATOR_ENTRIES.state}`;

/**
 * 状态目录自己的 `.gitignore`, 相对于项目根目录; 由 init 写入.
 * @type {string}
 */
export const NAVIGATOR_IGNORE_FILE = `${NAVIGATOR_DIRECTORY}/${NAVIGATOR_ENTRIES.ignoreFile}`;

/**
 * 草稿目录, 相对于项目根目录; 编排会话在这里写命令的输入, 不入库.
 * @type {string}
 */
export const DRAFTS_DIRECTORY = `${NAVIGATOR_DIRECTORY}/${NAVIGATOR_ENTRIES.drafts}`;

/**
 * 工单文件夹所在目录, 相对于项目根目录.
 * @type {string}
 */
export const ORDERS_DIRECTORY = `${NAVIGATOR_DIRECTORY}/${NAVIGATOR_ENTRIES.orders}`;

/**
 * 工单文件夹中各文件的文件名.
 * @type {Readonly<{order: string, receipt: string, review: string}>}
 */
export const ORDER_FILES = Object.freeze({
  order: "order.md",
  receipt: "receipt.md",
  review: "review.md",
});

/**
 * 工单文件夹中存放证据文件的子目录名: 执行子代理留下的抓包原文, 复现脚本等
 * 供验收独立复核的产物.
 * @type {string}
 */
export const ORDER_ARTIFACTS_DIRECTORY = "artifacts";

/**
 * 项目规范文件, 相对于项目根目录. 项目内所有会话自动加载, 由 standards 命令写入.
 * @type {string}
 */
export const ENGINEERING_RULES_FILE = ".claude/rules/engineering.md";

/**
 * 本机专用的 Claude Code 配置文件, 相对于项目根目录. 不入库.
 * @type {string}
 */
export const PROJECT_LOCAL_SETTINGS_FILE = ".claude/settings.local.json";

/**
 * 项目级 Claude Code 配置文件, 相对于项目根目录.
 * @type {string}
 */
export const PROJECT_SETTINGS_FILE = ".claude/settings.json";

/**
 * 推进路线文件, 相对于项目根目录; 由脚本从状态文件整份生成.
 * @type {string}
 */
export const ROADMAP_FILE = ".navigator/plan/roadmap.md";

/**
 * 风险清单文件, 相对于项目根目录; 由脚本从状态文件整份生成.
 * @type {string}
 */
export const RISKS_FILE = ".navigator/plan/risks.md";

/**
 * 术语表, 相对于项目根目录; init 写入流程术语, 编排会话追加项目术语.
 * @type {string}
 */
export const GLOSSARY_FILE = ".navigator/plan/glossary.md";

/**
 * 由脚本生成, 禁止用工具直接编辑的文件, 相对于项目根目录.
 * @type {readonly string[]}
 */
export const GENERATED_FILES = Object.freeze([
  STATE_FILE,
  ROADMAP_FILE,
  RISKS_FILE,
]);

/**
 * 工单审阅记录在运行期登记目录中的文件名: 用户在 "工单审阅" 中对哪张工单的
 * 哪一版内容作出了选择.
 * @type {string}
 */
export const ORDER_APPROVAL_FILE = "order-approval.json";

/**
 * 技能异常记录在运行期登记目录中的文件名: 脚本自己发现的内部错误, hook 错误,
 * 状态不自洽等, 供生成问题报告.
 * @type {string}
 */
export const DIAGNOSTICS_FILE = "diagnostics.json";

/**
 * 最近一次给出的下一动作在运行期登记目录中的文件名, 用来发现 "照着做却被拒"
 * 与原地打转.
 * @type {string}
 */
export const GUIDANCE_FILE = "guidance.json";

/**
 * 问题报告所在目录, 相对于项目根目录. 在草稿目录之下, 不入库.
 * @type {string}
 */
export const REPORTS_DIRECTORY = `${DRAFTS_DIRECTORY}/reports`;

/**
 * 运行期登记信息在 Git 目录中的子目录名. 不入库, 也不受回退影响.
 * @type {string}
 */
export const RUNTIME_REGISTRY_DIRECTORY = "navigator";

/**
 * 源码证据缓存在运行期登记目录中的子目录名: 每个第三方仓库一个裸仓库.
 * 放在 Git 目录中, 不进入工作区, 检查工具与格式化工具都扫不到.
 * @type {string}
 */
export const EVIDENCE_CACHE_DIRECTORY = "evidence";

/**
 * 1.0.0 之前复制进项目的运行脚本目录, 相对于项目根目录.
 * @type {string}
 */
export const LEGACY_BIN_DIRECTORY = ".navigator/bin";

/**
 * 1.0.0 之前复制进项目的执行手册目录, 相对于项目根目录.
 * @type {string}
 */
export const LEGACY_GUIDE_DIRECTORY = ".navigator/guide";

/**
 * 1.0.0 之前的项目级 hook 引用的入口脚本, 用于从项目配置中移除这些 hook.
 * @type {string}
 */
export const LEGACY_HOOK_ENTRY_ARGUMENT =
  "${CLAUDE_PROJECT_DIR}/.navigator/bin/runtime/hook.mjs";

/**
 * 1.0.0 之前的放行规则中引用的项目内命令路径.
 * @type {string}
 */
export const LEGACY_COMMAND_PATH = ".navigator/bin/runtime/navigator.mjs";

/**
 * 1.0.0 之前写在运行期登记目录中的文件与目录: 会话登记, 待并入快照的写入,
 * 用户消息记录, 提交结算记录, 自检请求与心跳.
 * @type {readonly string[]}
 */
export const LEGACY_REGISTRY_ENTRIES = Object.freeze([
  "orchestrator.json",
  "sessions",
  "pending-writes",
  "prompts.json",
  "commit-settlement.json",
  "probe.json",
  "probe-request.json",
]);

/**
 * 1.0.0 之前存放状态目录快照的隐藏引用.
 * @type {string}
 */
export const LEGACY_SNAPSHOT_REF = "refs/navigator/snapshots";

/**
 * 技能目录的绝对路径, 由本文件位置 (`<技能目录>/runtime/lib/paths.mjs`) 推出.
 * @type {string}
 */
export const SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * 模板规格文件的绝对路径.
 * @type {string}
 */
export const SPEC_FILE = path.join(SKILL_ROOT, "spec", "templates.json");

/**
 * 通用工程规范默认包的绝对路径.
 * @type {string}
 */
export const STANDARDS_FILE = path.join(
  SKILL_ROOT,
  "standards",
  "engineering.md",
);

/**
 * 技能目录中执行手册的绝对路径, 由生成脚本产出.
 * @type {string}
 */
export const GUIDE_SOURCE_FILE = path.join(SKILL_ROOT, "guide", "executor.md");

/**
 * 技能目录中参考文件所在目录的绝对路径.
 * @type {string}
 */
export const REFERENCES_DIRECTORY = path.join(SKILL_ROOT, "references");

/**
 * 当前平台的文件系统是否不区分大小写.
 * @type {boolean}
 */
const IS_CASE_INSENSITIVE = process.platform === "win32";

/**
 * 返回状态目录中某个条目的绝对路径.
 *
 * @param {string} projectRoot 项目根目录的绝对路径.
 * @param {keyof typeof NAVIGATOR_ENTRIES} [entry] 条目名; 省略时返回状态目录本身.
 * @returns {string} 绝对路径.
 */
export function navigatorPath(projectRoot, entry) {
  const base = path.join(projectRoot, NAVIGATOR_DIRECTORY);
  return entry === undefined ? base : path.join(base, NAVIGATOR_ENTRIES[entry]);
}

/**
 * 返回工单文件夹中某个文件的项目相对路径.
 *
 * @param {string} folder 工单文件夹名, 例如 "0007-export-csv".
 * @param {keyof typeof ORDER_FILES} kind 文件种类.
 * @returns {string} 以正斜杠分隔的项目相对路径.
 */
export function orderFilePath(folder, kind) {
  return `${ORDERS_DIRECTORY}/${folder}/${ORDER_FILES[kind]}`;
}

/**
 * 返回工单文件夹中证据文件目录的项目相对路径.
 *
 * @param {string} folder 工单文件夹名, 例如 "0007-export-csv".
 * @returns {string} 以正斜杠分隔的项目相对路径, 不带结尾斜杠.
 */
export function orderArtifactsPath(folder) {
  return `${ORDERS_DIRECTORY}/${folder}/${ORDER_ARTIFACTS_DIRECTORY}`;
}

/**
 * 从某个目录向上查找 Git 工作区根目录 (含 `.git` 目录或文件的目录).
 *
 * @param {string} startDirectory 开始查找的目录.
 * @returns {string | undefined} 工作区根目录; 找不到时为 undefined.
 */
export function findWorktreeRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  for (;;) {
    if (existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * 解析工作区的公共 Git 目录, 不启动 git 进程.
 *
 * 普通仓库直接返回 `.git` 目录; worktree 中 `.git` 是一个文件, 需要沿
 * `gitdir:` 与 `commondir` 找到主仓库的 Git 目录.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string} 公共 Git 目录的绝对路径.
 */
export function gitCommonDirectory(worktreeRoot) {
  const dotGit = path.join(worktreeRoot, ".git");
  if (statSync(dotGit).isDirectory()) {
    return dotGit;
  }
  const pointer = readFileSync(dotGit, "utf8").trim();
  const gitDirectory = path.resolve(
    worktreeRoot,
    pointer.replace(/^gitdir:\s*/u, ""),
  );
  const commonFile = path.join(gitDirectory, "commondir");
  if (!existsSync(commonFile)) {
    return gitDirectory;
  }
  return path.resolve(gitDirectory, readFileSync(commonFile, "utf8").trim());
}

/**
 * 返回运行期登记目录的绝对路径.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string} 登记目录的绝对路径.
 */
export function registryDirectory(worktreeRoot) {
  return path.join(
    gitCommonDirectory(worktreeRoot),
    RUNTIME_REGISTRY_DIRECTORY,
  );
}

/**
 * 返回源码证据缓存目录的绝对路径.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string} 缓存目录的绝对路径.
 */
export function evidenceCacheDirectory(worktreeRoot) {
  return path.join(registryDirectory(worktreeRoot), EVIDENCE_CACHE_DIRECTORY);
}

/**
 * 把绝对路径转换成相对于项目根目录, 以正斜杠分隔的路径.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string} targetPath 目标路径, 可以是相对或绝对路径.
 * @returns {string | undefined} 项目内的相对路径; 目标在项目之外时为 undefined.
 */
export function projectRelativePath(projectRoot, targetPath) {
  const relative = path.relative(
    path.resolve(projectRoot),
    path.resolve(projectRoot, targetPath),
  );
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

/**
 * 按平台规则比较两个以正斜杠分隔的相对路径是否相同.
 *
 * @param {string} first 第一个相对路径.
 * @param {string} second 第二个相对路径.
 * @returns {boolean} 指向同一位置时返回 true.
 */
export function relativePathsEqual(first, second) {
  return normalizeForComparison(first) === normalizeForComparison(second);
}

/**
 * 按平台规则判断相对路径是否位于某个相对目录之下.
 *
 * @param {string} relativePath 以正斜杠分隔的相对路径.
 * @param {string} directory 以正斜杠分隔的相对目录, 不带结尾斜杠.
 * @returns {boolean} 位于该目录之下 (不含目录本身) 时返回 true.
 */
export function isUnderDirectory(relativePath, directory) {
  return normalizeForComparison(relativePath).startsWith(
    `${normalizeForComparison(directory)}/`,
  );
}

/**
 * 按平台规则统一路径大小写, 仅用于比较.
 *
 * @param {string} value 路径.
 * @returns {string} 用于比较的路径.
 */
function normalizeForComparison(value) {
  return IS_CASE_INSENSITIVE ? value.toLowerCase() : value;
}
