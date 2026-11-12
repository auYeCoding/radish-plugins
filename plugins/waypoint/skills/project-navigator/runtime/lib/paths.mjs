/**
 * @file 项目内各类路径与插件命令名的唯一定义, 以及路径归属判断.
 *
 * 运行脚本只在插件目录中运行: 命令经插件 `bin/` 中的 `project-navigator` 调用,
 * hook 由插件的 `hooks/hooks.json` 调用. 所有相对路径都在这里定义, 其它模块不写
 * 路径字面量.
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
 * 1.x 的状态目录归档后的目录名, 相对于项目根目录.
 * @type {string}
 */
export const ARCHIVE_DIRECTORY = ".navigator-1.x";

/**
 * 状态文件, 相对于项目根目录.
 * @type {string}
 */
export const STATE_FILE = `${NAVIGATOR_DIRECTORY}/state.json`;

/**
 * 状态目录自己的 `.gitignore`, 相对于项目根目录; 由 init 写入.
 * @type {string}
 */
export const NAVIGATOR_IGNORE_FILE = `${NAVIGATOR_DIRECTORY}/.gitignore`;

/**
 * 路线视图, 相对于项目根目录; 由脚本从状态文件整份生成.
 * @type {string}
 */
export const ROADMAP_FILE = `${NAVIGATOR_DIRECTORY}/roadmap.md`;

/**
 * 需求文件, 相对于项目根目录; 由编排会话在立项时写入.
 * @type {string}
 */
export const REQUIREMENTS_FILE = `${NAVIGATOR_DIRECTORY}/requirements.md`;

/**
 * 决策记录, 相对于项目根目录; 由 decision 命令追加条目.
 * @type {string}
 */
export const DECISIONS_FILE = `${NAVIGATOR_DIRECTORY}/decisions.md`;

/**
 * 待办文件, 相对于项目根目录; 记录当前切片之外的想法.
 * @type {string}
 */
export const BACKLOG_FILE = `${NAVIGATOR_DIRECTORY}/backlog.md`;

/**
 * 切片文件所在目录, 相对于项目根目录.
 * @type {string}
 */
export const SLICES_DIRECTORY = `${NAVIGATOR_DIRECTORY}/slices`;

/**
 * 只产出结论的切片存放产物的目录, 相对于项目根目录.
 * @type {string}
 */
export const FINDINGS_DIRECTORY = `${NAVIGATOR_DIRECTORY}/findings`;

/**
 * 草稿目录, 相对于项目根目录; 编排会话在这里写命令的输入, 不入库.
 * @type {string}
 */
export const DRAFTS_DIRECTORY = `${NAVIGATOR_DIRECTORY}/drafts`;

/**
 * 项目规范文件, 相对于项目根目录. 项目内所有会话自动加载, 由 setup 命令写入.
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
 * 由脚本生成, 禁止用工具直接编辑的文件, 相对于项目根目录.
 * @type {readonly string[]}
 */
export const GENERATED_FILES = Object.freeze([STATE_FILE, ROADMAP_FILE]);

/**
 * 技能产物的范围: 状态目录与插件管理的项目配置. 草稿由状态目录的忽略规则排除.
 * @type {readonly string[]}
 */
export const COMMITTED_PATHSPECS = Object.freeze([
  NAVIGATOR_DIRECTORY,
  PROJECT_SETTINGS_FILE,
  ENGINEERING_RULES_FILE,
]);

/**
 * 必须能入库的路径, 用于检查项目的忽略规则; 切片与结论各取一个示例位置.
 * @type {readonly string[]}
 */
export const REQUIRED_TRACKED_PATHS = Object.freeze([
  NAVIGATOR_IGNORE_FILE,
  STATE_FILE,
  ROADMAP_FILE,
  REQUIREMENTS_FILE,
  DECISIONS_FILE,
  BACKLOG_FILE,
  `${SLICES_DIRECTORY}/0001-sample.md`,
  `${FINDINGS_DIRECTORY}/sample.md`,
  PROJECT_SETTINGS_FILE,
  ENGINEERING_RULES_FILE,
]);

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
 * 切片文件规格的绝对路径.
 * @type {string}
 */
export const SLICE_SPEC_FILE = path.join(SKILL_ROOT, "spec", "slice.json");

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
 * 实现手册的绝对路径.
 * @type {string}
 */
export const GUIDE_FILE = path.join(SKILL_ROOT, "guide", "executor.md");

/**
 * 参考文件所在目录的绝对路径.
 * @type {string}
 */
export const REFERENCES_DIRECTORY = path.join(SKILL_ROOT, "references");

/**
 * 插件共享的标点规则文件的绝对路径.
 * @type {string}
 */
export const PUNCTUATION_FILE = path.resolve(
  SKILL_ROOT,
  "..",
  "..",
  "shared",
  "punctuation.md",
);

/**
 * 当前平台的文件系统是否不区分大小写.
 * @type {boolean}
 */
const IS_CASE_INSENSITIVE = process.platform === "win32";

/**
 * 返回切片文件的项目相对路径.
 *
 * @param {string} id 切片编号, 例如 "0003".
 * @param {string} slug 短名, 例如 "export-csv".
 * @returns {string} 以正斜杠分隔的项目相对路径.
 */
export function sliceFilePath(id, slug) {
  return `${SLICES_DIRECTORY}/${id}-${slug}.md`;
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
