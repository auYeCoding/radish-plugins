/**
 * @file 下一动作与进展: "接下来做什么" 的唯一来源.
 *
 * 按状态与切片文件中的事实计算, status 命令与 hook 的位置提醒共用. 这里只给出
 * 动作与要运行的命令, 做法的细节在参考文件中.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  BACKLOG_FILE,
  COMMAND_NAME,
  FINDINGS_DIRECTORY,
  REQUIREMENTS_FILE,
} from "./paths.mjs";
import {
  activeSlice,
  currentMilestone,
  isMilestoneSettled,
  isSliceSettled,
  nextPendingSlice,
} from "./roadmap.mjs";
import {
  PARTS,
  SECTIONS,
  VERDICT_CLASSES,
  classifyVerdicts,
  loadSliceSpec,
  partSpec,
  readResultStatus,
  readSliceFile,
  readVerdicts,
  sectionTitle,
} from "./slice-file.mjs";
import {
  SLICE_STATUSES,
  SLICE_STATUS_LABELS,
  STAGES,
  STAGE_LABELS,
} from "./state.mjs";

/**
 * @typedef {import("./state.mjs").NavigatorState} NavigatorState
 * @typedef {import("./state.mjs").SliceState} SliceState
 * @typedef {import("./slice-file.mjs").SliceSpec} SliceSpec
 */

/**
 * @typedef {object} ProgressFacts 计算下一动作需要的, 不在状态文件中的事实.
 * @property {boolean} hasRequirements 需求文件是否已经写入.
 * @property {string} resultStatus 进行中切片的执行状态; 没有时为空字符串.
 * @property {number} verdictCount 标准核对表的行数; 还没有填写时为 0.
 * @property {string[]} verdictProblems 标准核对表中的问题.
 * @property {string} verdictClass 标准核对结果的归类, 见 VERDICT_CLASSES.
 */

/**
 * 读取计算下一动作需要的事实.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {NavigatorState} state 状态.
 * @param {SliceSpec} [spec] 切片文件规格.
 * @returns {ProgressFacts} 事实.
 */
export function readFacts(projectRoot, state, spec = loadSliceSpec()) {
  const slice = activeSlice(state)?.slice;
  const parsed =
    slice === undefined
      ? undefined
      : readSliceFile(projectRoot, slice.file, spec);
  const verdicts = readVerdicts(parsed, spec);
  return {
    hasRequirements: existsSync(path.join(projectRoot, REQUIREMENTS_FILE)),
    resultStatus: readResultStatus(parsed, spec),
    verdictCount: verdicts.rows.length,
    verdictProblems: verdicts.problems,
    verdictClass: classifyVerdicts(verdicts.rows, spec),
  };
}

/**
 * 描述当前位置: 阶段, 里程, 切片与环节.
 *
 * @param {NavigatorState} state 状态.
 * @returns {string} 一行进展.
 */
export function progressLine(state) {
  const milestone = currentMilestone(state);
  if (state.stage !== STAGES.slicing || milestone === undefined) {
    return `阶段 ${STAGE_LABELS[state.stage]}`;
  }
  const settled = milestone.slices.filter(isSliceSettled).length;
  const head = `里程 ${milestone.id} ${milestone.name} (${settled}/${milestone.slices.length})`;
  const slice = activeSlice(state)?.slice;
  if (slice === undefined || state.current === null) {
    return head;
  }
  return `${head} > 切片 ${slice.id} ${slice.name} [${SLICE_STATUS_LABELS[slice.status]}, 第 ${state.current.round} 轮]`;
}

/**
 * 计算下一动作.
 *
 * @param {NavigatorState} state 状态.
 * @param {ProgressFacts} facts 不在状态文件中的事实.
 * @param {SliceSpec} [spec] 切片文件规格.
 * @returns {string} 下一动作.
 */
export function nextAction(state, facts, spec = loadSliceSpec()) {
  if (state.stage === STAGES.finished) {
    return `项目已确认收尾. 用户提出新的工作时按 ${command("ref change")} 处理: 更新需求, 用 roadmap 追加里程.`;
  }
  if (state.stage === STAGES.intake) {
    return intakeAction(state, facts);
  }
  const active = activeSlice(state)?.slice;
  return active === undefined
    ? betweenSlicesAction(state)
    : sliceAction(active, facts, spec);
}

/**
 * 把命令写成可以直接运行的形式.
 *
 * @param {string} args 命令名与参数.
 * @returns {string} 带反引号的完整命令.
 */
export function command(args) {
  return `\`${COMMAND_NAME} ${args}\``;
}

/**
 * 立项阶段的下一动作.
 *
 * @param {NavigatorState} state 状态.
 * @param {ProgressFacts} facts 事实.
 * @returns {string} 下一动作.
 */
function intakeAction(state, facts) {
  if (!facts.hasRequirements) {
    return `立项: 先运行 ${command("ref intake")} 读立项步骤; 与用户逐个确认需求后写入 ${REQUIREMENTS_FILE}.`;
  }
  if (
    state.project.organization === null ||
    state.project.verification === null
  ) {
    return `登记项目设置: 运行 ${command("setup")} 查看建议, 与用户确认模块组织方式与验证方式后, 用 ${command("setup --from <草稿>")} 登记.`;
  }
  return `写路线: 按 ${command("ref intake")} 的 "路线" 一节写草稿, 运行 ${command("roadmap --from <草稿>")}.`;
}

/**
 * 没有进行中的切片时的下一动作.
 *
 * @param {NavigatorState} state 状态.
 * @returns {string} 下一动作.
 */
function betweenSlicesAction(state) {
  const milestone = currentMilestone(state);
  if (milestone === undefined) {
    return `全部里程已完成: 向用户说明成果, 用户确认后运行 ${command("finish")}; 还有新的工作时用 roadmap 追加里程.`;
  }
  const pending = nextPendingSlice(state);
  if (pending !== undefined) {
    return `为切片 ${pending.id} "${pending.name}" 写计划: 先读相关代码, 再运行 ${command(`slice plan ${pending.id} --slug <短名>`)}, 做法见 ${command("ref slice-loop")}.`;
  }
  if (isMilestoneSettled(milestone)) {
    return `里程复查 (${command("ref slice-loop")} 的 "里程复查"): 对照里程目标向用户说明达成情况, 整理 ${BACKLOG_FILE}, 用 roadmap 排出下一个里程的切片; 用户确认后运行 ${command(`milestone done ${milestone.id}`)}.`;
  }
  return `为里程 ${milestone.id} "${milestone.name}" 排出切片: 写路线草稿, 运行 ${command("roadmap --from <草稿>")}.`;
}

/**
 * 有进行中的切片时的下一动作.
 *
 * @param {SliceState} slice 进行中的切片.
 * @param {ProgressFacts} facts 事实.
 * @param {SliceSpec} spec 切片文件规格.
 * @returns {string} 下一动作.
 */
function sliceAction(slice, facts, spec) {
  if (slice.status === SLICE_STATUSES.planned) {
    return `填写切片文件 ${slice.file} 的 "${partSpec(spec, PARTS.plan).heading}" 段, 然后运行 ${command("slice start")}${slice.interactive ? "; 这是交互式切片, 开工后在本会话执行" : ", 按输出在后台派实现子代理"}.`;
  }
  if (slice.status === SLICE_STATUSES.running) {
    return runningAction(slice, facts, spec);
  }
  return reviewingAction(slice, facts, spec);
}

/**
 * 切片在实现中时的下一动作.
 *
 * @param {SliceState} slice 进行中的切片.
 * @param {ProgressFacts} facts 事实.
 * @param {SliceSpec} spec 切片文件规格.
 * @returns {string} 下一动作.
 */
function runningAction(slice, facts, spec) {
  const resultHeading = partSpec(spec, PARTS.result).heading;
  const statusTitle = sectionTitle(spec, SECTIONS.status);
  if (facts.resultStatus === spec.doneStatus) {
    return `运行 ${command("slice review")}, 按输出派验收子代理.`;
  }
  if (slice.interactive) {
    return `继续交互式切片 ${slice.id}: 在本会话按计划逐步做, 需要用户操作时直接说, 每确认一条结论立即写入 ${FINDINGS_DIRECTORY}/; 做完后填写 "${resultHeading}" 段, 把 "${statusTitle}" 改成 "${spec.doneStatus}", 再运行 ${command("slice review")}.`;
  }
  return `等待实现子代理. 它以 "交回: ..." 开头交回时, 把内容原样转告用户, 用户回复后用 SendMessage 让它继续 (找不到它时运行 ${command("brief exec")} 重新派出); 它已结束而 "${statusTitle}" 还不是 "${spec.doneStatus}" 时, 请它补写 "${resultHeading}" 段.`;
}

/**
 * 切片在验收中时的下一动作.
 *
 * @param {SliceState} slice 进行中的切片.
 * @param {ProgressFacts} facts 事实.
 * @param {SliceSpec} spec 切片文件规格.
 * @returns {string} 下一动作.
 */
function reviewingAction(slice, facts, spec) {
  const reviewHeading = partSpec(spec, PARTS.review).heading;
  const conclusion = sectionTitle(spec, SECTIONS.conclusion);
  const rework = sectionTitle(spec, SECTIONS.rework);
  if (facts.verdictCount === 0) {
    return `等待验收子代理; 它交回后把内容原样写入切片文件 ${slice.file} 的 "${reviewHeading}" 段 (找不到它时运行 ${command("brief review")} 重新派出).`;
  }
  if (facts.verdictProblems.length > 0) {
    return `修正切片文件的 "${reviewHeading}" 段: ${facts.verdictProblems.join(" ")}`;
  }
  const record = `把用户的原话写入 "${conclusion}"`;
  const redo = `把要补的内容写入计划的 "${rework}" 后运行 ${command("slice redo")}`;
  if (facts.verdictClass === VERDICT_CLASSES.pass) {
    return `验收全部通过, 请用户决定: A 通过并提交; B 通过, 提交并推送. 用户选择后${record}, 运行 ${command("slice accept")}.`;
  }
  if (facts.verdictClass === VERDICT_CLASSES.unverified) {
    return `有标准未验证. 用户已经亲手确认过的 (证据以 "${spec.userEvidencePrefix}" 开头, 或用户按 "${sectionTitle(spec, SECTIONS.manual)}" 做完并说了结果), 把结论改成 "${spec.verdicts.confirmed}", 证据写用户的原话与日期, 再运行 ${command("status")}, 不让用户重新选择. 还没有确认的, 先把步骤给用户; 用户不验证时请用户决定: A 接受现状并提交 (${record}, 运行 ${command("slice accept --accept-unverified")}); B 补做 (${redo}).`;
  }
  return slice.skeleton
    ? `有标准不通过, 这是最小骨架, 只能补做: 向用户说明后${redo}.`
    : `有标准不通过, 请用户决定: A 补做 (${redo}); B 放弃这个切片 (运行 ${command("slice drop")}).`;
}
