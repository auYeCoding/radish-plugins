/**
 * @file 项目内各类路径的唯一定义, 以及路径归属判断.
 *
 * 运行脚本在两处运行: 插件目录 (init 与 enter) 和项目的 `.navigator/bin/`
 * (hook 与其余命令). 所有相对路径都在这里定义, 其它模块不写路径字面量.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  bin: "bin",
  plan: "plan",
  orders: "orders",
  drafts: "drafts",
  guide: "guide",
  ignoreFile: ".gitignore",
});

/**
 * 状态文件, 相对于项目根目录.
 * @type {string}
 */
export const STATE_FILE = `${NAVIGATOR_DIRECTORY}/${NAVIGATOR_ENTRIES.state}`;

/**
 * 插件脚本目录, 相对于项目根目录; 受保护, 只有 init 能写.
 * @type {string}
 */
export const BIN_DIRECTORY = `${NAVIGATOR_DIRECTORY}/${NAVIGATOR_ENTRIES.bin}`;

/**
 * 草稿目录, 相对于项目根目录; 编排会话在这里写命令行脚本的输入, 不入库.
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
 * 运行脚本在项目内的副本中, 记录其版本号的文件名.
 * @type {string}
 */
export const RUNTIME_VERSION_FILE = "runtime-version.json";

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
 * 只能由插件脚本修改的项目配置文件, 相对于项目根目录.
 * @type {readonly string[]}
 */
export const PROTECTED_CONFIG_FILES = Object.freeze([
  PROJECT_SETTINGS_FILE,
  PROJECT_LOCAL_SETTINGS_FILE,
  ENGINEERING_RULES_FILE,
]);

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
 * 执行手册, 相对于项目根目录; 由 init 从技能目录复制.
 * @type {string}
 */
export const EXECUTOR_GUIDE_FILE = ".navigator/guide/executor.md";

/**
 * 由脚本生成, 禁止直接编辑的文件, 相对于项目根目录.
 * @type {readonly string[]}
 */
export const GENERATED_FILES = Object.freeze([
  ROADMAP_FILE,
  RISKS_FILE,
  EXECUTOR_GUIDE_FILE,
]);

/**
 * 初始化自检时用于探测写入守卫的文件, 相对于项目根目录. 守卫拦下对它的写入
 * 时会留下心跳记录, init 据此确认 hook 已生效.
 * @type {string}
 */
export const PROBE_FILE = `${BIN_DIRECTORY}/navigator-probe.txt`;

/**
 * 自检心跳记录在运行期登记目录中的文件名.
 * @type {string}
 */
export const PROBE_HEARTBEAT_FILE = "probe.json";

/**
 * 运行期登记信息在 Git 目录中的子目录名. 不入库, 也不受回退影响.
 * @type {string}
 */
export const RUNTIME_REGISTRY_DIRECTORY = "navigator";

/**
 * init 复制进 `.navigator/bin/` 的目录, 相对于技能目录. 复制后保持同样的相对
 * 布局, 因此运行脚本在插件目录与项目副本中用同一套相对路径找到规格文件.
 * 参考文件也复制进项目: 读取项目之外的插件文件在默认权限模式下需要用户批准.
 * @type {readonly string[]}
 */
export const RUNTIME_COPY_DIRECTORIES = Object.freeze([
  "runtime",
  "spec",
  "standards",
  "references",
]);

/**
 * hook 命令引用的入口脚本, 以项目目录变量开头, 由 Claude Code 在运行时替换.
 * @type {string}
 */
export const HOOK_ENTRY_ARGUMENT =
  "${CLAUDE_PROJECT_DIR}/.navigator/bin/runtime/hook.mjs";

/**
 * 编排会话调用项目内命令行脚本时使用的相对路径.
 * @type {string}
 */
export const PROJECT_COMMAND_PATH = ".navigator/bin/runtime/navigator.mjs";

/**
 * 技能目录的绝对路径: 插件中为 `skills/project-navigator/`, 项目副本中为
 * `.navigator/bin/`. 由本文件位置 (`<技能目录>/runtime/lib/paths.mjs`) 推出.
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
 * 技能目录中执行手册的绝对路径, 由生成脚本产出, init 复制进项目.
 * @type {string}
 */
export const GUIDE_SOURCE_FILE = path.join(SKILL_ROOT, "guide", "executor.md");

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
