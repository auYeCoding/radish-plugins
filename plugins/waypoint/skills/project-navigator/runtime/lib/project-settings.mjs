/**
 * @file 项目设置: 模块组织方式, 验证方式与项目约定的校验, 建议与项目规范的生成.
 *
 * 模块组织方式决定工程规范中 "模块如何表达" 一段的写法: 默认包中两种写法各占
 * 一个带标记的块, 写入项目时只保留对应的一块.
 */

import {
  AUTO_VERIFICATION,
  ORGANIZATIONS,
  ORGANIZATION_LABELS,
  VERIFICATION_LABELS,
} from "./state.mjs";
import { requireLabel } from "./validation.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 表明项目是 Visual Studio 项目的文件扩展名.
 * @type {readonly string[]}
 */
const VISUAL_STUDIO_EXTENSIONS = Object.freeze([
  ".sln",
  ".vcxproj",
  ".csproj",
  ".vbproj",
]);

/**
 * 默认包中按模块组织方式取舍的块: 开始标记, 内容, 结束标记.
 * @type {RegExp}
 */
const VARIANT_BLOCK_PATTERN =
  /<!-- begin:(\w+) -->\n([\s\S]*?)<!-- end:\1 -->\n?/gu;

/**
 * 写入项目规范时, 项目约定一节的标题.
 * @type {string}
 */
const CONVENTIONS_HEADING = "## 项目约定";

/**
 * 写入项目规范时, 一级标题之后的说明.
 * @type {string}
 */
const RULES_NOTICE =
  "本文件由 project-navigator 的 setup 命令写入, 不要直接编辑; 需要修改时在编排会话中重新运行 setup.";

/**
 * @typedef {object} SettingsDraft 项目设置草稿.
 * @property {string} organization 模块组织方式.
 * @property {{mode: string, commands?: string[]}} verification 验证方式.
 * @property {string[]} [conventions] 项目自己的约定.
 */

/**
 * 按已跟踪的文件给出模块组织方式的建议.
 *
 * @param {readonly string[]} trackedFiles 已跟踪文件的项目相对路径.
 * @returns {{organization: string, evidence: string[]}} 建议的组织方式, 以及作为依据的工程文件.
 */
export function suggestOrganization(trackedFiles) {
  const evidence = trackedFiles.filter((file) =>
    VISUAL_STUDIO_EXTENSIONS.some((extension) =>
      file.toLowerCase().endsWith(extension),
    ),
  );
  return {
    organization:
      evidence.length > 0 ? ORGANIZATIONS.filters : ORGANIZATIONS.directories,
    evidence,
  };
}

/**
 * 校验项目设置草稿.
 *
 * @param {SettingsDraft} draft 草稿.
 * @returns {import("./state.mjs").ProjectSettings} 校验后的项目设置.
 * @throws {WorkflowError} 草稿不合法时.
 */
export function validateSettings(draft) {
  const organization = requireLabel(
    draft?.organization,
    ORGANIZATION_LABELS,
    "模块组织方式 (organization)",
  );
  const mode = requireLabel(
    draft.verification?.mode,
    VERIFICATION_LABELS,
    "验证方式 (verification.mode)",
  );
  const commands = requireStrings(
    draft.verification.commands ?? [],
    "验证命令 (verification.commands)",
  );
  if (mode === AUTO_VERIFICATION && commands.length === 0) {
    throw new WorkflowError(
      `验证方式为 ${AUTO_VERIFICATION} 时, verification.commands 至少写一条能在仓库根目录直接运行的命令.`,
    );
  }
  return {
    organization,
    verification: { mode, commands },
    conventions: requireStrings(
      draft.conventions ?? [],
      "项目约定 (conventions)",
    ),
  };
}

/**
 * 生成写入项目的工程规范.
 *
 * @param {object} options 生成参数.
 * @param {string} options.standards 默认包全文.
 * @param {string} options.organization 模块组织方式.
 * @param {readonly string[]} options.conventions 项目自己的约定.
 * @returns {string} 项目规范全文.
 */
export function renderEngineeringRules({
  standards,
  organization,
  conventions,
}) {
  const [title, ...rest] = standards
    .replace(/\r\n?/gu, "\n")
    .replace(VARIANT_BLOCK_PATTERN, (_block, variant, content) =>
      variant === organization ? content : "",
    )
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd()
    .split("\n");
  return [
    title,
    "",
    RULES_NOTICE,
    ...rest,
    ...(conventions.length === 0
      ? []
      : [
          "",
          CONVENTIONS_HEADING,
          "",
          ...conventions.map((item) => `- ${item}`),
        ]),
    "",
  ].join("\n");
}

/**
 * 确认值是字符串数组, 并去掉每项的首尾空白.
 *
 * @param {unknown} value 值.
 * @param {string} label 字段名, 用于错误信息.
 * @returns {string[]} 字符串数组.
 * @throws {WorkflowError} 值不是字符串数组, 或其中有空字符串时.
 */
function requireStrings(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new WorkflowError(`${label}应为字符串数组, 每项不为空.`);
  }
  return value.map((item) => item.trim());
}
