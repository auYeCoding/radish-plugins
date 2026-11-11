/**
 * @file report 命令: 把技能自身的问题写成一份问题报告, 供用户转交给维护者.
 *
 * 用法: report [--from <草稿>]. 草稿格式:
 * {"doing": "当时在做什么", "expected": "预期发生什么", "actual": "实际发生了什么",
 *  "reproduce": "怎么复现", "blocked": false}
 *
 * 报告由两部分组成: 脚本填写的环境, 状态与异常记录; 草稿提供的经过. 报告只写
 * 遇到的情况本身, 不写原因推测与处理建议. 报告不含工单正文与业务代码, 项目路径
 * 与技能目录在报告中用占位写法代替.
 *
 * 状态文件损坏时也要能生成报告, 所以本命令不要求项目状态可读.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BLOCKING_EVENT_KINDS,
  EVENT_LABELS,
  markEventsReported,
  readGuidance,
  unreportedEvents,
} from "../lib/diagnostics.mjs";
import {
  REPORT_OPTIONS,
  REPORT_REPLY_TYPE,
  replyStep,
} from "../lib/guidance.mjs";
import { formatNumber } from "../lib/numbering.mjs";
import { REPORTS_DIRECTORY, SKILL_ROOT } from "../lib/paths.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import { loadSpec } from "../lib/spec.mjs";
import { readStateIfValid } from "../lib/state.mjs";
import { runtimeVersion } from "../lib/version.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { readDraftJson } from "./support.mjs";

/**
 * 草稿中描述经过的键, 以及它们在报告中的名称, 按顺序.
 * @type {readonly (readonly [string, string])[]}
 */
const NARRATIVE_FIELDS = Object.freeze([
  ["doing", "当时在做"],
  ["expected", "预期结果"],
  ["actual", "实际结果"],
  ["reproduce", "复现步骤"],
]);

/**
 * 报告文件名的前缀与扩展名.
 * @type {Readonly<{prefix: string, extension: string}>}
 */
const REPORT_FILE = Object.freeze({ prefix: "report-", extension: ".md" });

/**
 * 报告中没有内容的项写的值.
 * @type {string}
 */
const EMPTY = "未填写";

/**
 * 报告中代替项目根目录与技能目录的写法, 避免泄露本机路径.
 * @type {Readonly<{project: string, skill: string}>}
 */
const PATH_PLACEHOLDERS = Object.freeze({
  project: "<项目>",
  skill: "<技能目录>",
});

/**
 * 执行 report 命令.
 *
 * @param {object} options 命令参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行: 报告文件, 能否继续, 下一动作与报告全文.
 * @throws {WorkflowError} 不在 Git 仓库中, 或既没有异常记录也没有草稿时.
 */
export function runReport({ values, cwd, now }) {
  const projectRoot = findRepositoryRoot(cwd);
  if (projectRoot === undefined) {
    throw new WorkflowError("当前目录不是 Git 仓库.");
  }
  const draft =
    values.from === undefined ? {} : readDraftJson(projectRoot, values.from);
  const events = unreportedEvents(projectRoot);
  const narrative = NARRATIVE_FIELDS.map(([key, label]) => [
    label,
    typeof draft[key] === "string" ? draft[key].trim() : "",
  ]);
  if (events.length === 0 && narrative.every(([, text]) => text === "")) {
    throw new WorkflowError(
      '没有可上报的内容: 脚本没有记录到异常, 草稿中也没有经过. 先把遇到的情况写成草稿 {"doing", "expected", "actual", "reproduce"}, 再用 --from 传入.',
    );
  }
  const id = nextReportId(projectRoot);
  const content = sanitize(
    renderReport({ id, projectRoot, events, narrative, now }),
    projectRoot,
  );
  const relativeFile = `${REPORTS_DIRECTORY}/${REPORT_FILE.prefix}${id}${REPORT_FILE.extension}`;
  const file = path.join(projectRoot, relativeFile);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  markEventsReported(projectRoot, id);
  const isBlocking =
    draft.blocked === true ||
    events.some((event) => BLOCKING_EVENT_KINDS.includes(event.kind));
  const optionSet = isBlocking
    ? REPORT_OPTIONS.blocking
    : REPORT_OPTIONS.continuable;
  return [
    `- 报告文件: ${relativeFile}`,
    `- 能否继续: ${isBlocking ? "不能, 需要先修复技能或状态" : "能, 记录后可以继续推进"}`,
    `- 下一动作: ${replyStep(loadSpec(), REPORT_REPLY_TYPE, optionSet)}; "报告内容" 中放一个语言标记为 text 的代码块, 把下面的报告全文原样放进去, 不增删内容, 不加处理建议`,
    "",
    "报告全文:",
    "",
    ...content.trimEnd().split("\n"),
  ];
}

/**
 * 生成报告全文: 环境, 状态, 脚本记录的异常, 经过.
 *
 * @param {object} options 参数.
 * @param {string} options.id 报告编号.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("../lib/diagnostics.mjs").DiagnosticEvent[]} options.events 未上报的异常.
 * @param {string[][]} options.narrative 经过各项: 名称与内容.
 * @param {string} options.now 当前时间.
 * @returns {string} 报告全文, 以换行结尾.
 */
function renderReport({ id, projectRoot, events, narrative, now }) {
  return `${[
    `# project-navigator 问题报告 ${id}`,
    "",
    "## 环境",
    "",
    `- 插件版本: ${runtimeVersion()}`,
    `- 运行环境: Node.js ${process.versions.node}`,
    `- 操作系统: ${process.platform} ${os.release()}`,
    `- 生成时间: ${now}`,
    "",
    "## 状态",
    "",
    ...stateLines(projectRoot),
    "",
    "## 脚本记录的异常",
    "",
    ...(events.length === 0 ? ["无"] : events.flatMap(eventLines)),
    "",
    "## 经过",
    "",
    ...narrative.map(([label, text]) => `- ${label}: ${text || EMPTY}`),
  ].join("\n")}\n`;
}

/**
 * 生成状态摘要: 只含位置与工单的类型和状态, 不含项目内容.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {string[]} 各行.
 */
function stateLines(projectRoot) {
  const state = readStateIfValid(projectRoot);
  const guidance = readGuidance(projectRoot);
  if (state === undefined) {
    return ["- 状态文件: 不存在, 或不是合法的 JSON"];
  }
  const order = state.order;
  return [
    `- 结构版本: ${state.schema}, 写入版本 ${state.skillVersion}, 状态版本 ${state.revision}`,
    `- 当前位置: 阶段 ${state.stage ?? "无"}, 步骤 ${state.step}`,
    `- 当前工单: ${order === null ? "无" : `${order.id}, 类型 ${order.kind}, 状态 ${order.status}, 发布轮次 ${order.round}`}`,
    `- 最后动作: ${state.lastAction} (${state.updatedAt})`,
    `- 上次的下一动作: ${guidance === undefined ? "无记录" : `${guidance.action} (连续给出 ${guidance.count} 次)`}`,
  ];
}

/**
 * 生成一条异常的各行.
 *
 * @param {import("../lib/diagnostics.mjs").DiagnosticEvent} event 异常.
 * @param {number} index 序号, 从 0 开始.
 * @returns {string[]} 各行.
 */
function eventLines(event, index) {
  return [
    `### ${index + 1}. ${EVENT_LABELS[event.kind] ?? event.kind}`,
    "",
    `- 发生时间: ${event.at}`,
    `- 来源: ${event.source}`,
    `- 信息: ${event.message}`,
    ...(event.stack.length === 0
      ? []
      : ["- 调用栈:", ...event.stack.map((line) => `  - ${line}`)]),
    "",
  ];
}

/**
 * 去掉报告中的本机路径与会破坏代码块的反引号围栏.
 *
 * @param {string} content 报告全文.
 * @param {string} projectRoot 项目根目录.
 * @returns {string} 处理后的全文.
 */
function sanitize(content, projectRoot) {
  const replacements = [
    [SKILL_ROOT, PATH_PLACEHOLDERS.skill],
    [projectRoot, PATH_PLACEHOLDERS.project],
  ].flatMap(([target, placeholder]) => [
    [target, placeholder],
    [target.split(path.sep).join("/"), placeholder],
  ]);
  return replacements
    .reduce(
      (text, [target, placeholder]) => text.split(target).join(placeholder),
      content,
    )
    .replaceAll("```", "'''");
}

/**
 * 取下一份报告的编号: 报告目录中已有的最大编号加一.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {string} 四位编号.
 */
function nextReportId(projectRoot) {
  const directory = path.join(projectRoot, REPORTS_DIRECTORY);
  const numbers = existsSync(directory)
    ? readdirSync(directory)
        .filter(
          (name) =>
            name.startsWith(REPORT_FILE.prefix) &&
            name.endsWith(REPORT_FILE.extension),
        )
        .map((name) =>
          Number(
            name.slice(
              REPORT_FILE.prefix.length,
              -REPORT_FILE.extension.length,
            ),
          ),
        )
        .filter(Number.isInteger)
    : [];
  return formatNumber(Math.max(0, ...numbers) + 1);
}
