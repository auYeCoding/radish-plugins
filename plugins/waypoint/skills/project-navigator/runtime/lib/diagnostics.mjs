/**
 * @file 技能异常的发现与记录: 脚本自己能判断的技能问题记在运行期登记目录中,
 * 供 report 命令生成问题报告.
 *
 * 记录的是 "技能本身可能有问题" 的迹象, 不是流程规则的正常拒绝:
 * - 命令或 hook 抛出了内部错误 (类型错误, 文件系统错误等), 一定是技能的问题.
 * - 状态不自洽 (例如工单已发布, 工单文件却不存在).
 * - 上一次 "下一动作" 要求运行的命令被流程规则拒绝, 说明两处规则对不上.
 * - 同一个下一动作连续给出多次, 状态却没有变化.
 *
 * 记录失败不能影响命令与 hook 本身, 调用方要自行兜住这里抛出的错误.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonAtomically } from "./atomic-file.mjs";
import {
  COMMAND_NAME,
  DIAGNOSTICS_FILE,
  GUIDANCE_FILE,
  registryDirectory,
} from "./paths.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 异常的种类.
 * @type {Readonly<{internalError: string, hookError: string, invalidState: string, refused: string, stalled: string}>}
 */
export const EVENT_KINDS = Object.freeze({
  internalError: "internal-error",
  hookError: "hook-error",
  invalidState: "invalid-state",
  refused: "refused-after-guidance",
  stalled: "stalled",
});

/**
 * 各种异常在报告与输出中的中文名称.
 * @type {Readonly<Record<string, string>>}
 */
export const EVENT_LABELS = Object.freeze({
  [EVENT_KINDS.internalError]: "命令内部错误",
  [EVENT_KINDS.hookError]: "hook 内部错误",
  [EVENT_KINDS.invalidState]: "状态不自洽",
  [EVENT_KINDS.refused]: "下一动作要求的命令被拒绝",
  [EVENT_KINDS.stalled]: "下一动作重复而状态没有变化",
});

/**
 * 出现后流程无法继续的异常种类: 命令本身跑不了, 或状态已经不可信.
 * @type {readonly string[]}
 */
export const BLOCKING_EVENT_KINDS = Object.freeze([
  EVENT_KINDS.internalError,
  EVENT_KINDS.invalidState,
]);

/**
 * 发现技能异常后的上报做法, 命令输出, status 与提醒共用.
 * @type {string}
 */
export const REPORT_STEP = `把遇到的情况写成草稿 {"doing", "expected", "actual", "reproduce"} (只写事实, 不写原因推测与处理建议), 运行 ${COMMAND_NAME} report --from <草稿>, 再按输出回复 "问题报告"`;

/**
 * 保留的异常记录条数.
 * @type {number}
 */
const EVENT_LIMIT = 30;

/**
 * 同一个下一动作在状态不变时连续给出多少次算原地打转.
 * @type {number}
 */
const STALL_THRESHOLD = 4;

/**
 * 等待外部结果时记下的连续次数: 等待中的重复不计数.
 * @type {number}
 */
const WAITING_COUNT = 0;

/**
 * 记录中保留的调用栈行数.
 * @type {number}
 */
const STACK_LINE_LIMIT = 8;

/**
 * 属于输入问题而不是技能问题的 Node.js 错误码前缀: 命令行参数写错.
 * @type {string}
 */
const ARGUMENT_ERROR_PREFIX = "ERR_PARSE_ARGS";

/**
 * @typedef {object} DiagnosticEvent 一条异常记录.
 * @property {string} kind 种类, 取值见 EVENT_KINDS.
 * @property {string} source 来源: 命令行 (例如 "order set issued") 或 hook 事件名.
 * @property {string} message 错误信息或问题描述.
 * @property {string[]} stack 调用栈的前几行; 没有时为空.
 * @property {string} at 发生时间, ISO 格式.
 * @property {string} [reportId] 已写入的问题报告编号; 还没有上报时省略.
 */

/**
 * @typedef {object} GuidanceRecord 最近一次给出的下一动作.
 * @property {string} action 下一动作全文.
 * @property {number} revision 给出时状态文件的版本号.
 * @property {number} count 状态不变时连续给出同一动作的次数.
 */

/**
 * 判断一个错误是否是技能脚本的内部错误. 流程规则的拒绝 (WorkflowError 与脚本
 * 主动抛出的普通 Error) 和命令行参数写错都不算.
 *
 * @param {unknown} error 捕获到的错误.
 * @returns {boolean} 是内部错误时返回 true.
 */
export function isInternalError(error) {
  if (!(error instanceof Error) || error instanceof WorkflowError) {
    return false;
  }
  const code = /** @type {{code?: unknown}} */ (error).code;
  if (typeof code === "string") {
    return !code.startsWith(ARGUMENT_ERROR_PREFIX);
  }
  return (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError
  );
}

/**
 * 取出错误调用栈的前几行, 不含第一行的错误信息.
 *
 * @param {unknown} error 捕获到的错误.
 * @returns {string[]} 调用栈各行, 已去掉首尾空白.
 */
export function stackLines(error) {
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  return stack
    .split("\n")
    .slice(1, STACK_LINE_LIMIT + 1)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * 读取全部异常记录, 按发生的先后排列.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {DiagnosticEvent[]} 异常记录; 没有时为空.
 */
export function readEvents(worktreeRoot) {
  return readJson(worktreeRoot, DIAGNOSTICS_FILE) ?? [];
}

/**
 * 读取还没有写进问题报告的异常记录.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {DiagnosticEvent[]} 未上报的异常记录.
 */
export function unreportedEvents(worktreeRoot) {
  return readEvents(worktreeRoot).filter(
    (event) => event.reportId === undefined,
  );
}

/**
 * 记下一条异常. 已有种类, 来源与信息都相同的未上报记录时不重复记.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {Omit<DiagnosticEvent, "reportId">} event 异常.
 * @returns {boolean} 本次新记下了异常时返回 true.
 */
export function recordEvent(worktreeRoot, event) {
  const events = readEvents(worktreeRoot);
  const isKnown = events.some(
    (entry) =>
      entry.reportId === undefined &&
      entry.kind === event.kind &&
      entry.source === event.source &&
      entry.message === event.message,
  );
  if (isKnown) {
    return false;
  }
  writeJson(
    worktreeRoot,
    DIAGNOSTICS_FILE,
    [...events, event].slice(-EVENT_LIMIT),
  );
  return true;
}

/**
 * 把未上报的异常标为已写进某份问题报告.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} reportId 问题报告编号.
 * @returns {void}
 */
export function markEventsReported(worktreeRoot, reportId) {
  writeJson(
    worktreeRoot,
    DIAGNOSTICS_FILE,
    readEvents(worktreeRoot).map((event) =>
      event.reportId === undefined ? { ...event, reportId } : event,
    ),
  );
}

/**
 * 读取最近一次给出的下一动作.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {GuidanceRecord | undefined} 记录; 还没有时为 undefined.
 */
export function readGuidance(worktreeRoot) {
  return readJson(worktreeRoot, GUIDANCE_FILE);
}

/**
 * 记下这次给出的下一动作, 并发现原地打转: 状态不变时同一个动作连续给出达到
 * 阈值的那一次, 记一条异常. 正在等待 (例如等执行子代理) 时重复是正常的, 不计数.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {object} options 参数.
 * @param {string} options.action 下一动作全文.
 * @param {number} options.revision 状态文件的版本号.
 * @param {boolean} options.isWaiting 当前是否在等待外部结果.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {void}
 */
export function trackGuidance(
  worktreeRoot,
  { action, revision, isWaiting, now },
) {
  const previous = readGuidance(worktreeRoot);
  const isRepeat =
    previous !== undefined &&
    previous.action === action &&
    previous.revision === revision;
  const count = isWaiting
    ? WAITING_COUNT
    : (isRepeat ? previous.count : WAITING_COUNT) + 1;
  writeJson(worktreeRoot, GUIDANCE_FILE, { action, revision, count });
  if (count === STALL_THRESHOLD) {
    recordEvent(worktreeRoot, {
      kind: EVENT_KINDS.stalled,
      source: "status",
      message: `同一个下一动作已连续给出 ${count} 次, 状态版本 ${revision} 没有变化: ${action}`,
      stack: [],
      at: now,
    });
  }
}

/**
 * 判断一条被拒绝的命令是不是上一次下一动作要求运行的命令.
 *
 * @param {GuidanceRecord | undefined} guidance 最近一次给出的下一动作.
 * @param {string} commandLine 命令名加位置参数, 例如 "order set issued".
 * @returns {boolean} 下一动作中写了这条命令时返回 true.
 */
export function isRecommendedCommand(guidance, commandLine) {
  return (
    guidance !== undefined &&
    commandLine.trim() !== "" &&
    guidance.action.includes(commandLine)
  );
}

/**
 * 读取运行期登记目录中的 JSON 文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} name 文件名.
 * @returns {any} 文件内容; 不存在时为 undefined.
 */
function readJson(worktreeRoot, name) {
  const file = path.join(registryDirectory(worktreeRoot), name);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/**
 * 原子写入运行期登记目录中的 JSON 文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} name 文件名.
 * @param {unknown} value 要写入的值.
 * @returns {void}
 */
function writeJson(worktreeRoot, name, value) {
  writeJsonAtomically(path.join(registryDirectory(worktreeRoot), name), value);
}
