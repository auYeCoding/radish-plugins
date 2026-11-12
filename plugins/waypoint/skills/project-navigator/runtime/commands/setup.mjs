/**
 * @file setup 命令: 登记模块组织方式, 验证方式与项目约定, 并写入项目规范.
 *
 * 用法: setup [--from <草稿>]. 不带草稿时只输出现有设置, 建议与草稿格式; 带草稿
 * 时登记, 并把工程规范默认包按模块组织方式写入 `.claude/rules/engineering.md`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomically } from "../lib/atomic-file.mjs";
import { ENGINEERING_RULES_FILE, STANDARDS_FILE } from "../lib/paths.mjs";
import {
  renderEngineeringRules,
  suggestOrganization,
  validateSettings,
} from "../lib/project-settings.mjs";
import { listTrackedFiles } from "../lib/repo.mjs";
import { ORGANIZATION_LABELS, VERIFICATION_LABELS } from "../lib/state.mjs";
import { openProject, readDraftJson, saveState } from "./support.mjs";

/**
 * 输出建议时, 作为依据列出的工程文件的最多个数.
 * @type {number}
 */
const EVIDENCE_LIMIT = 3;

/**
 * 草稿的格式说明.
 * @type {string}
 */
const DRAFT_FORMAT =
  '{"organization": "directories 或 filters", "verification": {"mode": "auto, manual 或 measured", "commands": ["能在仓库根目录直接运行的命令"]}, "conventions": ["项目自己的约定, 可以为空"]}';

/**
 * 执行 setup 命令.
 *
 * @param {import("./handlers.mjs").CommandInvocation} invocation 命令调用.
 * @returns {string[]} 输出各行.
 */
export function runSetup({ values, cwd, now }) {
  const { projectRoot, state } = openProject(cwd);
  if (values.from === undefined) {
    return suggestionLines(projectRoot, state.project);
  }
  const project = validateSettings(readDraftJson(projectRoot, values.from));
  writeFileAtomically(
    path.join(projectRoot, ENGINEERING_RULES_FILE),
    renderEngineeringRules({
      standards: readFileSync(STANDARDS_FILE, "utf8"),
      organization: /** @type {string} */ (project.organization),
      conventions: project.conventions,
    }),
  );
  saveState(
    projectRoot,
    { ...state, project, lastAction: "登记项目设置" },
    now,
  );
  return [
    "- 执行结果: 已登记项目设置",
    ...settingsLines(project),
    `- 项目规范: 已写入 ${ENGINEERING_RULES_FILE}`,
  ];
}

/**
 * 输出现有设置, 建议与草稿格式.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").ProjectSettings} project 现有的项目设置.
 * @returns {string[]} 输出各行.
 */
function suggestionLines(projectRoot, project) {
  const { organization, evidence } = suggestOrganization(
    listTrackedFiles(projectRoot),
  );
  const reason =
    evidence.length === 0
      ? "没有找到 Visual Studio 的解决方案或工程文件"
      : `找到 ${evidence.slice(0, EVIDENCE_LIMIT).join(", ")}${evidence.length > EVIDENCE_LIMIT ? ` 等 ${evidence.length} 个文件` : ""}`;
  return [
    ...(project.organization === null
      ? ["- 现有设置: 未登记"]
      : settingsLines(project)),
    `- 组织建议: ${organization} (${ORGANIZATION_LABELS[organization]}), 依据: ${reason}. 由用户确认`,
    `- 验证方式: ${Object.entries(VERIFICATION_LABELS)
      .map(([mode, label]) => `${mode} (${label})`)
      .join(", ")}, 由用户确认; 不能构建或运行的项目不要选 auto`,
    `- 草稿格式: ${DRAFT_FORMAT}`,
  ];
}

/**
 * 把项目设置写成输出行.
 *
 * @param {import("../lib/state.mjs").ProjectSettings} project 项目设置.
 * @returns {string[]} 输出各行.
 */
function settingsLines(project) {
  const verification = /** @type {{mode: string, commands: string[]}} */ (
    project.verification
  );
  return [
    `- 模块组织: ${project.organization} (${ORGANIZATION_LABELS[/** @type {string} */ (project.organization)]})`,
    `- 验证方式: ${verification.mode} (${VERIFICATION_LABELS[verification.mode]})${verification.commands.length === 0 ? "" : `, 命令: ${verification.commands.join("; ")}`}`,
    `- 项目约定: ${project.conventions.length === 0 ? "无" : project.conventions.join("; ")}`,
  ];
}
