/**
 * @file standards 命令: 把规范对照的结果写入项目规范文件.
 *
 * 用法: standards --from <草稿>, 草稿格式
 * {"commentLanguage": "中文", "conventions": ["以项目现有的格式化配置为准.", ...]}
 *
 * 项目规范文件 = 插件的通用工程规范默认包 + 注释语言 + 项目约定. 项目约定来自
 * 规范对照中用户的选择, 与默认包冲突时以项目约定为准. 该文件受保护,
 * 所有会话都只能通过本命令修改.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ENGINEERING_RULES_FILE, STANDARDS_FILE } from "../lib/paths.mjs";
import { requireText } from "../lib/validation.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 执行 standards 命令.
 *
 * @param {object} options 命令参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {import("../lib/workflow-error.mjs").WorkflowError} 草稿不合法时.
 */
export function runStandards({ values, cwd, now }) {
  const context = openProject(cwd);
  const draft = readDraftJson(context.projectRoot, values.from);
  const commentLanguage = requireText(draft.commentLanguage, "注释语言");
  const conventions = Array.isArray(draft.conventions)
    ? draft.conventions.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const target = path.join(context.projectRoot, ENGINEERING_RULES_FILE);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    composeRules(
      readFileSync(STANDARDS_FILE, "utf8"),
      commentLanguage,
      conventions,
    ),
    "utf8",
  );
  const state = saveState(
    context,
    { ...context.state, lastAction: "写入项目规范" },
    now,
  );
  return [...resultLines(state), `- 规范文件: ${ENGINEERING_RULES_FILE}`];
}

/**
 * 拼接项目规范全文.
 *
 * @param {string} pack 通用工程规范默认包.
 * @param {string} commentLanguage 注释语言.
 * @param {string[]} conventions 项目约定.
 * @returns {string} 项目规范全文.
 */
function composeRules(pack, commentLanguage, conventions) {
  const conventionLines =
    conventions.length === 0
      ? ["无"]
      : conventions.map((item, index) => `${index + 1}. ${item}`);
  return [
    pack.trimEnd(),
    "",
    "## 注释语言",
    "",
    `代码注释使用${commentLanguage}.`,
    "",
    "## 项目约定",
    "",
    "本节来自规范对照中用户的选择, 与上文冲突时以本节为准.",
    "",
    ...conventionLines,
    "",
  ].join("\n");
}
