/**
 * @file slice 命令: 一个切片从写计划到结束的各步.
 *
 * 用法:
 * - slice plan <编号> --slug <短名>
 * - slice start [--decided]
 * - slice replan
 * - slice review
 * - slice accept [--accept-unverified]
 * - slice redo
 * - slice drop
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomically } from "../lib/atomic-file.mjs";
import { COMMIT_SKILL, SUBAGENT_TYPES } from "../lib/guard.mjs";
import { command } from "../lib/guidance.mjs";
import { FINDINGS_DIRECTORY, sliceFilePath } from "../lib/paths.mjs";
import { headCommit } from "../lib/repo.mjs";
import { activeSlice, currentMilestone } from "../lib/roadmap.mjs";
import {
  PARTS,
  SECTIONS,
  VERDICT_CLASSES,
  classifyVerdicts,
  digestPlan,
  findUnfilledSections,
  isPlanSectionNone,
  loadSliceSpec,
  parseSliceFile,
  partSpec,
  prepareRework,
  readCriteria,
  readResultStatus,
  readVerdicts,
  renderSliceFile,
  sectionTitle,
} from "../lib/slice-file.mjs";
import {
  acceptSlice,
  dropSlice,
  planSlice,
  redoSlice,
  refreshPlan,
  reviewSlice,
  startSlice,
} from "../lib/slice-flow.mjs";
import { SLICE_KIND_LABELS } from "../lib/state.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { openProject, saveState } from "./support.mjs";

/**
 * 切片文件短名的格式: 小写字母, 数字与连字符.
 * @type {RegExp}
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * @typedef {object} SliceCommandContext 一次 slice 子命令的上下文.
 * @property {string} projectRoot 项目根目录.
 * @property {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @property {import("../lib/slice-file.mjs").SliceSpec} spec 切片文件规格.
 * @property {string[]} positionals 子命令之后的位置参数.
 * @property {Record<string, any>} values 选项值.
 * @property {string} now 当前时间, ISO 格式.
 */

/**
 * 每个子命令的处理函数.
 * @type {Readonly<Record<string, (context: SliceCommandContext) => string[]>>}
 */
const SUBCOMMANDS = Object.freeze({
  plan: runSlicePlan,
  start: runSliceStart,
  replan: runSliceReplan,
  review: runSliceReview,
  accept: runSliceAccept,
  redo: runSliceRedo,
  drop: runSliceDrop,
});

/**
 * 执行 slice 命令.
 *
 * @param {import("./handlers.mjs").CommandInvocation} invocation 命令调用.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 子命令未知或操作不被允许时.
 */
export function runSlice({ positionals, values, cwd, now }) {
  const [subcommand, ...rest] = positionals;
  if (subcommand === undefined || !Object.hasOwn(SUBCOMMANDS, subcommand)) {
    throw new WorkflowError(
      `slice 的用法: slice <${Object.keys(SUBCOMMANDS).join(" | ")}>.`,
    );
  }
  return SUBCOMMANDS[subcommand]({
    ...openProject(cwd),
    spec: loadSliceSpec(),
    positionals: rest,
    values,
    now,
  });
}

/**
 * slice plan: 建切片文件, 写入骨架.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 短名不合法, 文件已存在或切片不能开始时.
 */
function runSlicePlan({ projectRoot, state, spec, positionals, values, now }) {
  const [id] = positionals;
  if (typeof values.slug !== "string" || !SLUG_PATTERN.test(values.slug)) {
    throw new WorkflowError(
      "slice plan 的用法: slice plan <编号> --slug <短名>, 短名只用小写字母, 数字与连字符, 例如 export-csv.",
    );
  }
  const file = sliceFilePath(id ?? "", values.slug);
  const next = planSlice(state, id, file);
  if (existsSync(path.join(projectRoot, file))) {
    throw new WorkflowError(`切片文件 ${file} 已经存在, 换一个短名.`);
  }
  const { slice } = /** @type {NonNullable<ReturnType<typeof activeSlice>>} */ (
    activeSlice(next)
  );
  const milestone = currentMilestone(next);
  writeFileAtomically(
    path.join(projectRoot, file),
    renderSliceFile({
      spec,
      slice,
      summary: [
        `里程 ${milestone?.id} ${milestone?.name}`,
        `种类: ${SLICE_KIND_LABELS[slice.kind]}`,
        ...(slice.skeleton ? ["最小骨架"] : []),
        ...(slice.interactive ? ["交互式"] : []),
      ].join("; "),
    }),
  );
  saveState(projectRoot, next, now);
  const plan = partSpec(spec, PARTS.plan).heading;
  return [
    `- 执行结果: 已建切片文件 ${file}`,
    `- 填写要求: 只填 "${plan}" 段, 把每处 "${spec.placeholder}...)" 换成内容; 小节内不加标题; "${sectionTitle(spec, SECTIONS.criteria)}" 写成编号列表; 其余两段保持原样`,
    `- 下一动作: 填好后运行 ${command("slice start")}`,
  ];
}

/**
 * slice start: 核对计划已填好, 记下基准提交与计划摘要, 开工.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 计划没有填好, 有待用户决定的事, 或仓库还没有提交时.
 */
function runSliceStart({ projectRoot, state, spec, values, now }) {
  const { slice, parsed } = readActive(projectRoot, state, spec);
  const plan = partSpec(spec, PARTS.plan).heading;
  const unfilled = findUnfilledSections({
    parsed,
    spec,
    partId: PARTS.plan,
    kind: slice.kind,
  });
  if (unfilled.length > 0) {
    throw new WorkflowError(`"${plan}" 段还没有填好: ${unfilled.join(", ")}.`);
  }
  if (readCriteria(parsed, spec).length === 0) {
    throw new WorkflowError(
      `"${sectionTitle(spec, SECTIONS.criteria)}" 要写成编号列表, 至少一条.`,
    );
  }
  if (
    !isPlanSectionNone(parsed, spec, SECTIONS.decisions) &&
    values.decided !== true
  ) {
    throw new WorkflowError(
      `"${sectionTitle(spec, SECTIONS.decisions)}" 中有要用户决定的事: 先问用户, 把答案写在这一节, 再运行 slice start --decided.`,
    );
  }
  const baseCommit = headCommit(projectRoot);
  if (baseCommit === undefined) {
    throw new WorkflowError("仓库还没有任何提交, 先提交一次再开工.");
  }
  const next = startSlice(state, {
    baseCommit,
    planDigest: /** @type {string} */ (digestPlan(parsed)),
  });
  saveState(projectRoot, next, now);
  return [
    `- 执行结果: ${next.lastAction}, 基准提交 ${baseCommit}`,
    `- 下一动作: ${dispatchStep(slice)}`,
  ];
}

/**
 * slice replan: 实现期间计划有改动时重新记下摘要.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 */
function runSliceReplan({ projectRoot, state, spec, now }) {
  const { parsed } = readActive(projectRoot, state, spec);
  const next = refreshPlan(state, /** @type {string} */ (digestPlan(parsed)));
  saveState(projectRoot, next, now);
  return [`- 执行结果: ${next.lastAction}`];
}

/**
 * slice review: 核对执行结果已写完, 计划段没有被改动, 送验.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 执行状态不是完成, 计划段被改动, 或执行结果没有填好时.
 */
function runSliceReview({ projectRoot, state, spec, now }) {
  const next = reviewSlice(state);
  const { slice, parsed } = readActive(projectRoot, state, spec);
  const result = partSpec(spec, PARTS.result).heading;
  if (readResultStatus(parsed, spec) !== spec.doneStatus) {
    throw new WorkflowError(
      `"${sectionTitle(spec, SECTIONS.status)}" 还不是 "${spec.doneStatus}": 实现没有做完, 不能送验.`,
    );
  }
  if (digestPlan(parsed) !== state.current?.planDigest) {
    throw new WorkflowError(
      `切片文件的 "${partSpec(spec, PARTS.plan).heading}" 段在开工之后被改动. 是你按用户的回答改的, 运行 slice replan 后再送验; 不是的话用 git diff 查看, 恢复后再送验.`,
    );
  }
  const unfilled = findUnfilledSections({
    parsed,
    spec,
    partId: PARTS.result,
    kind: slice.kind,
  });
  if (unfilled.length > 0) {
    throw new WorkflowError(
      `"${result}" 段还没有填好: ${unfilled.join(", ")}. 请实现方补写.`,
    );
  }
  saveState(projectRoot, next, now);
  return [
    `- 执行结果: ${next.lastAction}`,
    `- 下一动作: 用 Agent 工具派出 ${SUBAGENT_TYPES.reviewer}, 提示词是 ${command("brief review")} 的输出原文; 它交回后把内容原样写入切片文件的 "${partSpec(spec, PARTS.review).heading}" 段`,
  ];
}

/**
 * slice accept: 核对验收段, 切片结束.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 验收段没有填好, 有标准不通过, 或有未验证而没有带接受参数时.
 */
function runSliceAccept({ projectRoot, state, spec, values, now }) {
  const next = acceptSlice(state);
  const { slice, parsed } = readActive(projectRoot, state, spec);
  const review = partSpec(spec, PARTS.review).heading;
  const verdictTitle = sectionTitle(spec, SECTIONS.verdicts);
  const unfilled = findUnfilledSections({
    parsed,
    spec,
    partId: PARTS.review,
    kind: slice.kind,
  });
  if (unfilled.length > 0) {
    throw new WorkflowError(
      `"${review}" 段还没有填好: ${unfilled.join(", ")}.`,
    );
  }
  const { rows, problems } = readVerdicts(parsed, spec);
  if (problems.length > 0) {
    throw new WorkflowError(problems.join(" "));
  }
  if (rows.length < readCriteria(parsed, spec).length) {
    throw new WorkflowError(
      `"${verdictTitle}" 只有 ${rows.length} 行, 少于完成标准的条数: 每条标准一行.`,
    );
  }
  const verdictClass = classifyVerdicts(rows, spec);
  if (verdictClass === VERDICT_CLASSES.fail) {
    throw new WorkflowError(
      `"${verdictTitle}" 中有 ${spec.verdicts.fail} 的标准, 不能通过: 补做 (slice redo) 或放弃 (slice drop).`,
    );
  }
  if (
    verdictClass === VERDICT_CLASSES.unverified &&
    values["accept-unverified"] !== true
  ) {
    throw new WorkflowError(
      `"${verdictTitle}" 中有 ${spec.verdicts.unverified} 的标准: 用户已经亲手确认的, 把结论改成 "${spec.verdicts.confirmed}" 并在证据中写下用户的原话; 用户没有验证而明确接受现状时, 运行 slice accept --accept-unverified.`,
    );
  }
  saveState(projectRoot, next, now);
  return [
    `- 执行结果: ${next.lastAction}`,
    `- 提交步骤: 调用 ${COMMIT_SKILL} 提交 "切片 ${slice.id} ${slice.name}", 参数写 "提交, 纳入全部改动"; 用户选了推送时写 "提交并推送, 纳入全部改动"`,
    `- 下一动作: 提交后运行 ${command("status")}`,
  ];
}

/**
 * slice redo: 归档本轮验收, 回到实现中.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 计划的补做一节还没有写时.
 */
function runSliceRedo({ projectRoot, state, spec, now }) {
  const { slice, file, text, parsed } = readActive(projectRoot, state, spec);
  const rework = sectionTitle(spec, SECTIONS.rework);
  if (isPlanSectionNone(parsed, spec, SECTIONS.rework)) {
    throw new WorkflowError(
      `先把要补的内容写入 "${partSpec(spec, PARTS.plan).heading}" 段的 "${rework}", 再运行 slice redo.`,
    );
  }
  const round = /** @type {{round: number}} */ (state.current).round;
  const reworked = prepareRework({ text, spec, kind: slice.kind, round });
  const next = redoSlice(
    state,
    /** @type {string} */ (digestPlan(parseSliceFile(reworked, spec))),
  );
  writeFileAtomically(file, reworked);
  saveState(projectRoot, next, now);
  return [
    `- 执行结果: ${next.lastAction}; 第 ${round} 轮的验收已归档在切片文件中`,
    `- 下一动作: ${
      slice.interactive
        ? `在本会话按 "${rework}" 继续做`
        : `用 SendMessage 让原来的实现子代理按 "${rework}" 继续; 找不到它时, ${dispatchStep(slice)}`
    }`,
  ];
}

/**
 * slice drop: 放弃进行中的切片.
 *
 * @param {SliceCommandContext} context 上下文.
 * @returns {string[]} 输出各行.
 */
function runSliceDrop({ projectRoot, state, now }) {
  const next = dropSlice(state);
  saveState(projectRoot, next, now);
  return [
    `- 执行结果: ${next.lastAction}`,
    `- 下一动作: 工作区中属于这个切片的改动由用户决定保留或撤销; 然后运行 ${command("status")}`,
  ];
}

/**
 * 读取进行中的切片及其文件.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("../lib/state.mjs").NavigatorState} state 当前状态.
 * @param {import("../lib/slice-file.mjs").SliceSpec} spec 切片文件规格.
 * @returns {{slice: import("../lib/state.mjs").SliceState, file: string, text: string, parsed: import("../lib/slice-file.mjs").ParsedSlice}} 切片, 文件的绝对路径, 全文与解析结果.
 * @throws {WorkflowError} 没有进行中的切片, 或切片文件不存在时.
 */
function readActive(projectRoot, state, spec) {
  const slice = activeSlice(state)?.slice;
  if (slice === undefined || slice.file === null) {
    throw new WorkflowError(
      "没有进行中的切片; 先用 slice plan 为一个切片建计划.",
    );
  }
  const file = path.join(projectRoot, slice.file);
  if (!existsSync(file)) {
    throw new WorkflowError(`切片文件 ${slice.file} 不存在, 请用 git 恢复.`);
  }
  const text = readFileSync(file, "utf8");
  return { slice, file, text, parsed: parseSliceFile(text, spec) };
}

/**
 * 写出开工之后由谁来做: 交互式切片在本会话做, 其余在后台派实现子代理.
 *
 * @param {import("../lib/state.mjs").SliceState} slice 切片.
 * @returns {string} 一步动作.
 */
function dispatchStep(slice) {
  if (slice.interactive) {
    return `这是交互式切片, 在本会话按计划逐步做: 需要用户操作时直接说, 每确认一条结论立即写入 ${FINDINGS_DIRECTORY}/; 做完后填写执行结果, 运行 ${command("slice review")}`;
  }
  return `用 Agent 工具在后台 (run_in_background) 派出 ${SUBAGENT_TYPES.executor}, 提示词是 ${command("brief exec")} 的输出原文`;
}
