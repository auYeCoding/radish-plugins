/**
 * @file ref 命令: 输出技能中的参考文件, 实现手册, 工程规范默认包, 或技能规则.
 *
 * 用法: ref <名称>. 参考文件在插件目录中, 默认权限模式下用 Read 读取项目之外的
 * 文件需要用户批准; 用放行规则中的插件命令输出内容, 不弹确认, 也总是当前版本.
 * 实现手册之后附上插件共享的标点规则, 规则只在那一个文件中维护.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  GUIDE_FILE,
  PUNCTUATION_FILE,
  REFERENCES_DIRECTORY,
  SKILL_FILE,
  STANDARDS_FILE,
} from "../lib/paths.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";

/**
 * 参考文件之外可以输出的内容, 键为名称, 值为依次输出的文件.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const EXTRA_FILES = Object.freeze({
  executor: [GUIDE_FILE, PUNCTUATION_FILE],
  standards: [STANDARDS_FILE],
});

/**
 * 输出技能规则的名称: 上下文压缩之后技能内容不在上下文中, 用它重新读规则.
 * @type {string}
 */
const SKILL_NAME = "skill";

/**
 * 技能规则中从这个标题开始的部分只在调用技能时有意义 (调用参数与当前状态),
 * 重新读规则时不输出.
 * @type {string}
 */
const SKILL_INVOCATION_HEADING = "## 调用参数";

/**
 * 技能规则开头的 frontmatter 的格式.
 * @type {RegExp}
 */
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n/u;

/**
 * 参考文件的扩展名.
 * @type {string}
 */
const REFERENCE_EXTENSION = ".md";

/**
 * 执行 ref 命令.
 *
 * @param {object} options 命令参数.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 名称不存在时.
 */
export function runRef({ positionals }) {
  const files = availableFiles();
  const [name] = positionals;
  if (name === SKILL_NAME) {
    return skillRules();
  }
  if (name === undefined || !Object.hasOwn(files, name)) {
    throw new WorkflowError(
      `ref 的用法: ref <名称>, 名称为 ${[...Object.keys(files), SKILL_NAME].join(", ")} 之一.`,
    );
  }
  return files[name].flatMap((file, index) => [
    ...(index === 0 ? [] : [""]),
    ...readFileSync(file, "utf8").trimEnd().split(/\r?\n/u),
  ]);
}

/**
 * 读取技能规则: 去掉 frontmatter 与只在调用时有意义的末尾部分.
 *
 * @returns {string[]} 输出各行.
 */
function skillRules() {
  const body = readFileSync(SKILL_FILE, "utf8").replace(
    FRONTMATTER_PATTERN,
    "",
  );
  const end = body.indexOf(SKILL_INVOCATION_HEADING);
  return (end < 0 ? body : body.slice(0, end)).trim().split(/\r?\n/u);
}

/**
 * 列出可以输出的内容: 参考文件目录中的每个 Markdown 文件, 以及实现手册与工程规范.
 *
 * @returns {Record<string, readonly string[]>} 名称到文件绝对路径的映射.
 */
function availableFiles() {
  const references = existsSync(REFERENCES_DIRECTORY)
    ? readdirSync(REFERENCES_DIRECTORY)
        .filter((file) => file.endsWith(REFERENCE_EXTENSION))
        .map((file) => [
          path.basename(file, REFERENCE_EXTENSION),
          [path.join(REFERENCES_DIRECTORY, file)],
        ])
    : [];
  return { ...Object.fromEntries(references), ...EXTRA_FILES };
}
