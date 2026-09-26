/**
 * @file 由状态整份生成 `plan/roadmap.md` 与 `plan/risks.md`.
 *
 * 这两个文件只是状态的视图, 禁止手改; 每次状态变化后由命令行脚本重新生成,
 * 保证表格中的编号与状态和 `state.json` 一致.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { RISKS_FILE, ROADMAP_FILE } from "./paths.mjs";
import { renderTable } from "./table.mjs";
import { PROGRESS_STATUS_LABELS } from "./workflow-plan.mjs";
import {
  RISK_SEVERITY_LABELS,
  RISK_STATUS_LABELS,
} from "./workflow-records.mjs";

/**
 * 由状态生成的视图文件, 相对于项目根目录. 每次保存状态都重新生成或删除,
 * 保存后的快照要一并更新这些文件.
 * @type {readonly string[]}
 */
export const PLAN_VIEW_FILES = Object.freeze([ROADMAP_FILE, RISKS_FILE]);

/**
 * 严重程度与状态的取值说明, 写在风险清单末尾.
 * @type {readonly string[]}
 */
const RISK_LEGEND = Object.freeze([
  "- 严重程度: 高 = 可能推翻主线或架构; 中 = 影响一个里程; 低 = 影响一个切片",
  "- 状态取值: 待处理; 调研中; 已处理; 已接受 (你确认不处理)",
]);

/**
 * 重新生成两个视图文件; 没有内容时删除对应文件.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {void}
 */
export function writePlanViews(projectRoot, state, format) {
  writeOrRemove(
    path.join(projectRoot, ROADMAP_FILE),
    state.milestones.length === 0 ? undefined : renderRoadmap(state, format),
  );
  writeOrRemove(
    path.join(projectRoot, RISKS_FILE),
    state.risks.length === 0 ? undefined : renderRisks(state, format),
  );
}

/**
 * 生成推进路线全文.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {string} 文件全文.
 */
export function renderRoadmap(state, format) {
  const sections = state.milestones.flatMap((milestone) => {
    const slices = state.slices.filter(
      (slice) => slice.milestone === milestone.id,
    );
    return [
      "",
      `## 里程 ${milestone.id}: ${milestone.name}`,
      "",
      `- 里程目标: ${milestone.goal}`,
      `- 覆盖指标: ${milestone.metrics.length === 0 ? format.emptyValue : milestone.metrics.join(", ")}`,
      `- 里程状态: ${PROGRESS_STATUS_LABELS[milestone.status]}`,
      "",
      ...renderTable(
        ["切片", "名称", "状态", "工单"],
        slices.map((slice) => [
          slice.id,
          slice.name,
          PROGRESS_STATUS_LABELS[slice.status],
          slice.orders.length === 0
            ? format.emptyValue
            : slice.orders.join(", "),
        ]),
      ),
    ];
  });
  const done = state.slices.filter((slice) => slice.status === "done").length;
  const current =
    state.slice === null ? format.emptyValue : `切片 ${state.slice}`;
  const summary = `共 ${state.milestones.length} 个里程 ${state.slices.length} 个切片, 已完成 ${done} 个切片, 当前在做 ${current}.`;
  return joinDocument(["# 推进路线", ...sections], summary, format);
}

/**
 * 生成风险清单全文.
 *
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {string} 文件全文.
 */
export function renderRisks(state, format) {
  const open = state.risks.filter((risk) => risk.status === "open").length;
  const summary = `共 ${state.risks.length} 项风险, 其中 ${open} 项待处理.`;
  return joinDocument(
    [
      "# 风险清单",
      "",
      "## 风险列表",
      "",
      ...renderTable(
        ["编号", "风险描述", "严重程度", "来源", "状态", "处理"],
        state.risks.map((risk) => [
          risk.id,
          risk.description,
          RISK_SEVERITY_LABELS[risk.severity],
          risk.source,
          RISK_STATUS_LABELS[risk.status],
          risk.handling,
        ]),
      ),
      "",
      "## 取值说明",
      "",
      ...RISK_LEGEND,
    ],
    summary,
    format,
  );
}

/**
 * 生成术语表的初始内容: 流程术语取自规格, 项目术语留空待编排会话追加.
 *
 * @param {import("./spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string} 文件全文.
 */
export function renderGlossarySeed(spec) {
  const [processTitle, projectTitle] = spec.files.glossary.sections.map(
    (section) => section.title,
  );
  return joinDocument(
    [
      `# ${spec.files.glossary.title}`,
      "",
      `## ${processTitle}`,
      "",
      ...renderTable(["术语", "定义"], spec.processTerms),
      "",
      `## ${projectTitle}`,
      "",
      spec.format.emptyValue,
    ],
    `术语表含 ${spec.processTerms.length} 个流程术语, 项目术语在立项时补充.`,
    spec.format,
  );
}

/**
 * 在正文之后加上人类总结代码块, 拼成以换行结尾的全文.
 *
 * @param {string[]} lines 正文各行.
 * @param {string} summary 总结正文.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {string} 文件全文.
 */
function joinDocument(lines, summary, format) {
  const fence = "```";
  return `${[
    ...lines,
    "",
    `${fence}${format.summaryLanguage}`,
    format.summarySeparator,
    summary,
    fence,
  ].join("\n")}\n`;
}

/**
 * 写入文件, 内容为 undefined 时删除文件.
 *
 * @param {string} file 文件路径.
 * @param {string | undefined} content 文件内容.
 * @returns {void}
 */
function writeOrRemove(file, content) {
  if (content === undefined) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}
