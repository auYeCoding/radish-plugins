/**
 * @file 由脚本生成的委派提示词: 实现子代理与验收子代理.
 *
 * 提示词由脚本生成, 编排会话原样使用, 不在其中加入倾向性说明或删掉检查项.
 * 这里是这些提示词的唯一来源; 小节名取自切片文件规格.
 */

import path from "node:path";

import {
  COMMAND_NAME,
  ENGINEERING_RULES_FILE,
  FINDINGS_DIRECTORY,
  NAVIGATOR_DIRECTORY,
} from "./paths.mjs";
import { PARTS, SECTIONS, partSpec, sectionsFor } from "./slice-file.mjs";
import {
  AUTO_VERIFICATION,
  ORGANIZATIONS,
  ORGANIZATION_LABELS,
  SLICE_KINDS,
  SLICE_KIND_LABELS,
  VERIFICATION_LABELS,
} from "./state.mjs";

/**
 * 实现子代理交回给编排会话的要点最多行数.
 * @type {number}
 */
const SUMMARY_LINES = 3;

/**
 * 实现子代理交回内容第一行的写法.
 * @type {Readonly<{done: string, question: string, action: string}>}
 */
export const HANDBACKS = Object.freeze({
  done: "交回: 完成",
  question: "交回: 需要回答",
  action: "交回: 需要操作",
});

/**
 * 结构核对逐项要回答的问题.
 * @type {readonly string[]}
 */
const STRUCTURE_CHECKS = Object.freeze([
  "每个新文件是否在计划写明的模块中",
  "新增的常量, 类型, 配置, 规则是否只有一处定义",
  "跨层调用是否只通过接口, 依赖方向是否与项目规范一致",
  "是否有可以复用却重写的实现",
  "是否新建了只有一处使用的通用模块或公共层",
  "新功能是否迫使多个已有模块改动内部实现",
]);

/**
 * @typedef {object} BriefContext 生成提示词需要的信息.
 * @property {string} projectRoot 项目根目录.
 * @property {import("./state.mjs").SliceState} slice 切片.
 * @property {import("./state.mjs").CurrentSlice} current 切片的运行信息.
 * @property {import("./state.mjs").ProjectSettings} project 项目设置.
 * @property {import("./slice-file.mjs").SliceSpec} spec 切片文件规格.
 */

/**
 * 生成实现子代理的委派提示词.
 *
 * @param {BriefContext} context 生成提示词需要的信息.
 * @returns {string} 提示词全文.
 */
export function buildExecutorBrief(context) {
  const { slice, current, spec } = context;
  const titles = sectionTitles(spec);
  const plan = partSpec(spec, PARTS.plan).heading;
  const result = partSpec(spec, PARTS.result).heading;
  const isBuild = slice.kind === SLICE_KINDS.build;
  return [
    `# 实现切片 ${slice.id}: ${slice.name}`,
    "",
    `你是实现子代理. 先运行 \`${COMMAND_NAME} ref executor\` 读完实现手册, 再读切片文件的 "${plan}" 段, 然后按手册工作.`,
    "",
    "## 本切片",
    "",
    ...subjectLines(context),
    ...(slice.skeleton
      ? [
          "- 最小骨架: 是. 从真实入口进入, 经过计划中的每一层, 每层只做最少的事; 要能按验证方式确认它跑通了.",
        ]
      : []),
    ...(current.round > 1
      ? [
          `- 补做: 这是第 ${current.round} 轮, 只做 "${plan}" 段 "${titles[SECTIONS.rework]}" 一节写的内容, 并更新 "${result}" 段.`,
        ]
      : []),
    "",
    "## 规则",
    "",
    isBuild
      ? `1. 可以写业务文件, 切片文件的 "${result}" 段, 以及 ${FINDINGS_DIRECTORY}/ 下的文件. 不改切片文件的其它段与 ${NAVIGATOR_DIRECTORY}/ 下的其它文件.`
      : `1. 本切片只产出结论: 只写 ${FINDINGS_DIRECTORY}/ 下的文件与切片文件的 "${result}" 段, 不改业务代码与项目配置.`,
    `2. 不提交, 不推送, 不运行改变状态的插件命令 (\`${COMMAND_NAME}\` 只用 ref, status 与 check).`,
    `3. 做完后填写 "${result}" 段的每个小节, 把 "${titles[SECTIONS.status]}" 改成 "${spec.doneStatus}", 然后结束.`,
    "",
    "## 交回格式",
    "",
    `- 做完时: 第一行写 "${HANDBACKS.done}", 其后不超过 ${SUMMARY_LINES} 行要点: 最重要的实现决定, 修正与待定标准.`,
    `- 需要用户回答或亲手操作才能继续时: 先把已经查清的内容写进 "${result}" 段的 "${titles[SECTIONS.notes]}", 第一行写 "${HANDBACKS.question}" 或 "${HANDBACKS.action}", 其后逐条写问题或操作步骤, 写到用户不用追问就能照做. "${titles[SECTIONS.status]}" 保持不变.`,
  ].join("\n");
}

/**
 * 生成验收子代理的委派提示词.
 *
 * @param {BriefContext & {filterLines: readonly string[]}} context 生成提示词需要的信息; filterLines 是筛选器检查的输出, 没有做时为空.
 * @returns {string} 提示词全文.
 */
export function buildReviewBrief(context) {
  const { slice, current, project, spec, filterLines } = context;
  const titles = sectionTitles(spec);
  const { pass, fail, unverified } = spec.verdicts;
  const plan = partSpec(spec, PARTS.plan).heading;
  const result = partSpec(spec, PARTS.result).heading;
  const review = partSpec(spec, PARTS.review);
  const isBuild = slice.kind === SLICE_KINDS.build;
  const verdictColumns = /** @type {string[]} */ (
    review.sections.find((section) => section.id === SECTIONS.verdicts)?.table
  );
  const requirements = [
    `${titles[SECTIONS.verdicts]}: 逐条对照 "${plan}" 段的 "${titles[SECTIONS.criteria]}"${current.round > 1 ? ` 与 "${titles[SECTIONS.rework]}"` : ""}, 每条给出结论与证据 (文件路径与行号, 或命令的原样输出). 结论只能是 ${pass}, ${fail}, ${unverified} 之一; 无法确认的写 ${unverified}, 并写明缺少什么. "${result}" 段 "${titles[SECTIONS.pending]}" 列出的标准, 核对原因是否属实: 属实时结论写 ${unverified}, 证据以 "待定: " 开头; 不属实时按实际情况下结论.`,
    ...(isBuild
      ? [
          `${titles[SECTIONS.wiringCheck]}: 从程序入口追到本切片的新代码, 写出调用路径经过的 文件:行号, 并与 "${result}" 段的 "${titles[SECTIONS.wiring]}" 比对; 追不到即为没有接线, 相关标准为 ${fail}.${slice.skeleton ? " 本切片是最小骨架: 另外确认入口是真实入口, 并且经过了计划中的每一层." : ""}`,
          `${titles[SECTIONS.structure]}: 对照 "${plan}" 段的 "${titles[SECTIONS.modules]}" 与 ${ENGINEERING_RULES_FILE}, 逐项回答并附证据: ${STRUCTURE_CHECKS.map((check, index) => `(${index + 1}) ${check}`).join("; ")}. 任一项有问题时, 相关标准为 ${fail}.${project.organization === ORGANIZATIONS.filters ? ' 模块以筛选器为准, 按下方 "筛选器检查" 的结果判断第 (1) 项.' : ""}`,
        ]
      : []),
    `${titles[SECTIONS.scope]}: 用 git diff ${current.baseCommit} --stat 与 git status 列出实际改动, 与 "${result}" 段的 "${titles[SECTIONS.changes]}" 比对; 列出做了 "${titles[SECTIONS.excluded]}" 的改动.${isBuild ? "" : " 本切片只产出结论, 业务代码与项目配置不应有改动."}`,
    `${titles[SECTIONS.correctionCheck]}: "${result}" 段 "${titles[SECTIONS.corrections]}" 表的每一行, 核对 "实际情况" 有没有证据支持, "处理办法" 有没有改变目标, 完成标准或做了明确不做的事. 两项都没有问题的修正成立, 相关标准按修正后的事实判断; 否则相关标准为 ${fail}. 没有修正时写 "${spec.none}".`,
    verificationRequirement(context, titles),
    ...(isBuild
      ? []
      : [
          `结论核对: ${FINDINGS_DIRECTORY}/ 下本切片写的每条结论, 是否写明宿主或依赖的版本, 位置, 验证方法与验证时间; 能重新读取或重新运行的, 读一遍或运行一遍, 与结论不符的, 相关标准为 ${fail}. 结果写进 "${titles[SECTIONS.verdicts]}" 的证据.`,
        ]),
  ];
  const handback = sectionsFor(review, slice.kind)
    .filter((section) => section.id !== SECTIONS.conclusion)
    .map((section) =>
      section.id === SECTIONS.verdicts
        ? `${section.title} (表格, 列为 ${verdictColumns.join(", ")})`
        : section.title,
    );
  return [
    `# 验收切片 ${slice.id}: ${slice.name}`,
    "",
    "你是验收子代理: 只读, 不写任何文件, 不给修改建议, 只报告事实与证据.",
    "",
    "## 验收对象",
    "",
    ...subjectLines(context),
    `- 项目规范: ${ENGINEERING_RULES_FILE}`,
    ...(filterLines.length === 0
      ? []
      : ["", "## 筛选器检查", "", ...filterLines]),
    "",
    "## 核对要求",
    "",
    ...requirements.map((requirement, index) => `${index + 1}. ${requirement}`),
    "",
    "## 交回格式",
    "",
    `按以下小节依次交回, 每节以小节名作标题, 内容会被原样写入切片文件: ${handback.join("; ")}.`,
  ].join("\n");
}

/**
 * 生成两种提示词共用的切片信息.
 *
 * @param {BriefContext} context 生成提示词需要的信息.
 * @returns {string[]} 各行.
 */
function subjectLines({ projectRoot, slice, current, project }) {
  const verification = /** @type {{mode: string, commands: string[]}} */ (
    project.verification
  );
  return [
    `- 切片文件: ${path.join(projectRoot, /** @type {string} */ (slice.file))}`,
    `- 种类: ${SLICE_KIND_LABELS[slice.kind]}`,
    `- 轮次: ${current.round}`,
    `- 基准提交: ${current.baseCommit}`,
    `- 模块组织方式: ${ORGANIZATION_LABELS[/** @type {string} */ (project.organization)]}`,
    `- 验证方式: ${VERIFICATION_LABELS[verification.mode]}${verification.commands.length === 0 ? "" : `, 命令: ${verification.commands.join("; ")}`}`,
  ];
}

/**
 * 生成验收提示词中关于验证运行的一条要求.
 *
 * @param {BriefContext} context 生成提示词需要的信息.
 * @param {Record<string, string>} titles 小节编号到标题的映射.
 * @returns {string} 要求全文.
 */
function verificationRequirement({ project, spec }, titles) {
  const verification = /** @type {{mode: string, commands: string[]}} */ (
    project.verification
  );
  const manual = `需要用户亲手运行或操作才能确认的标准, 结论写 ${spec.verdicts.unverified}, 并在 "${titles[SECTIONS.manual]}" 中写成逐步操作, 命令原样取自 "${titles[SECTIONS.tests]}"; 没有时写 "${spec.none}"`;
  return verification.mode === AUTO_VERIFICATION
    ? `验证运行: 运行 "验证方式" 中的命令与 "${titles[SECTIONS.tests]}" 中的命令, 原样记录结果; 检查是否删除, 放宽或跳过了已有测试. 需要真实账号, 会产生费用或外部副作用的命令不运行. ${manual}.`
    : `${titles[SECTIONS.manual]}: 本项目不靠自动测试验证, 不构建, 不运行程序. ${manual}.`;
}

/**
 * 取全部小节的标题.
 *
 * @param {import("./slice-file.mjs").SliceSpec} spec 切片文件规格.
 * @returns {Record<string, string>} 小节编号到标题的映射.
 */
function sectionTitles(spec) {
  return Object.fromEntries(
    spec.parts
      .flatMap((part) => part.sections)
      .map((section) => [section.id, section.title]),
  );
}
