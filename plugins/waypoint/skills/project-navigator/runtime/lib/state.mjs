/**
 * @file 状态文件 `state.json` 的结构, 创建, 读取与原子写入.
 *
 * `state.json` 是阶段, 项目设置, 里程, 切片与各类编号的唯一来源. 写入时比较
 * 版本号, 并用 "写临时文件再改名" 的方式替换, 防止并发写入互相覆盖或写出半个
 * 文件. 结构版本 6 是 2.0.0 的结构; 更早的结构不迁移, 由 init 归档.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonAtomically } from "./atomic-file.mjs";
import { STATE_FILE } from "./paths.mjs";

/**
 * 状态文件结构的版本号.
 * @type {number}
 */
export const STATE_SCHEMA_VERSION = 6;

/**
 * 初始化状态: 已初始化, 插件的 hook 在本项目中生效.
 * @type {string}
 */
export const INIT_ACTIVE = "active";

/**
 * 初始化状态: 已卸载, 记录保留, 插件的 hook 在本项目中不做任何事.
 * @type {string}
 */
export const INIT_UNINSTALLED = "uninstalled";

/**
 * 项目阶段的取值.
 * @type {Readonly<{intake: string, slicing: string, finished: string}>}
 */
export const STAGES = Object.freeze({
  intake: "intake",
  slicing: "slicing",
  finished: "finished",
});

/**
 * 项目阶段的中文名.
 * @type {Readonly<Record<string, string>>}
 */
export const STAGE_LABELS = Object.freeze({
  [STAGES.intake]: "立项",
  [STAGES.slicing]: "切片循环",
  [STAGES.finished]: "已收尾",
});

/**
 * 模块组织方式的取值.
 * @type {Readonly<{directories: string, filters: string}>}
 */
export const ORGANIZATIONS = Object.freeze({
  directories: "directories",
  filters: "filters",
});

/**
 * 模块组织方式的中文名.
 * @type {Readonly<Record<string, string>>}
 */
export const ORGANIZATION_LABELS = Object.freeze({
  [ORGANIZATIONS.directories]: "按物理目录分模块",
  [ORGANIZATIONS.filters]: "文件平铺, 用 Visual Studio 虚拟筛选器分模块",
});

/**
 * 需要登记命令的验证方式.
 * @type {string}
 */
export const AUTO_VERIFICATION = "auto";

/**
 * 验证方式的中文名, 键为验证方式的取值.
 * @type {Readonly<Record<string, string>>}
 */
export const VERIFICATION_LABELS = Object.freeze({
  [AUTO_VERIFICATION]: "自动测试",
  manual: "用户手动运行",
  measured: "实测",
});

/**
 * 里程状态的取值.
 * @type {Readonly<{pending: string, active: string, done: string}>}
 */
export const MILESTONE_STATUSES = Object.freeze({
  pending: "pending",
  active: "active",
  done: "done",
});

/**
 * 里程状态的中文名.
 * @type {Readonly<Record<string, string>>}
 */
export const MILESTONE_LABELS = Object.freeze({
  [MILESTONE_STATUSES.pending]: "未开始",
  [MILESTONE_STATUSES.active]: "进行中",
  [MILESTONE_STATUSES.done]: "已完成",
});

/**
 * 切片种类的取值.
 * @type {Readonly<{build: string, findings: string}>}
 */
export const SLICE_KINDS = Object.freeze({
  build: "build",
  findings: "findings",
});

/**
 * 切片种类的中文名.
 * @type {Readonly<Record<string, string>>}
 */
export const SLICE_KIND_LABELS = Object.freeze({
  [SLICE_KINDS.build]: "改代码",
  [SLICE_KINDS.findings]: "只产出结论",
});

/**
 * 切片状态的取值.
 * @type {Readonly<{pending: string, planned: string, running: string, reviewing: string, done: string, dropped: string}>}
 */
export const SLICE_STATUSES = Object.freeze({
  pending: "pending",
  planned: "planned",
  running: "running",
  reviewing: "reviewing",
  done: "done",
  dropped: "dropped",
});

/**
 * 切片状态的中文名.
 * @type {Readonly<Record<string, string>>}
 */
export const SLICE_STATUS_LABELS = Object.freeze({
  [SLICE_STATUSES.pending]: "未开始",
  [SLICE_STATUSES.planned]: "计划中",
  [SLICE_STATUSES.running]: "实现中",
  [SLICE_STATUSES.reviewing]: "验收中",
  [SLICE_STATUSES.done]: "已完成",
  [SLICE_STATUSES.dropped]: "已放弃",
});

/**
 * 读取状态文件时发现版本号与预期不一致时抛出的错误.
 */
export class StateConflictError extends Error {
  /**
   * @param {string} message 错误信息.
   */
  constructor(message) {
    super(message);
    this.name = "StateConflictError";
  }
}

/**
 * @typedef {object} SliceState 一个切片.
 * @property {string} id 切片编号.
 * @property {string} name 切片名称.
 * @property {string} kind 切片种类, 见 SLICE_KINDS.
 * @property {boolean} skeleton 是否为最小骨架.
 * @property {boolean} interactive 是否由用户正在对话的会话直接做.
 * @property {string} status 切片状态, 见 SLICE_STATUSES.
 * @property {string | null} file 切片文件的项目相对路径; 还没有写计划时为 null.
 */

/**
 * @typedef {object} MilestoneState 一个里程.
 * @property {string} id 里程编号.
 * @property {string} name 里程名称.
 * @property {string} goal 里程目标.
 * @property {string} status 里程状态, 见 MILESTONE_STATUSES.
 * @property {SliceState[]} slices 里程中的切片.
 */

/**
 * @typedef {object} CurrentSlice 进行中的切片的运行信息.
 * @property {string} sliceId 切片编号.
 * @property {string | null} baseCommit 开工时的提交; 还没有开工时为 null.
 * @property {string | null} planDigest 开工时计划段的摘要; 还没有开工时为 null.
 * @property {number} round 轮次, 补做一次加一.
 */

/**
 * @typedef {object} ProjectSettings 项目设置.
 * @property {string | null} organization 模块组织方式, 见 ORGANIZATIONS; 没有登记时为 null.
 * @property {{mode: string, commands: string[]} | null} verification 验证方式; 没有登记时为 null.
 * @property {string[]} conventions 项目自己的约定, 写入项目规范.
 */

/**
 * @typedef {object} NavigatorState 状态文件的内容.
 * @property {number} schema 结构版本号.
 * @property {number} revision 写入次数, 用于并发比较.
 * @property {string} skillVersion 写入该状态的技能版本.
 * @property {{status: string, initializedAt: string, uninstalledAt?: string}} init 初始化信息.
 * @property {string} stage 项目阶段, 见 STAGES.
 * @property {ProjectSettings} project 项目设置.
 * @property {MilestoneState[]} milestones 里程列表.
 * @property {CurrentSlice | null} current 进行中的切片; 没有时为 null.
 * @property {{id: string, title: string, supersededBy: string | null}[]} decisions 决策列表.
 * @property {Record<string, number>} next 各类编号的下一个值.
 * @property {string} lastAction 最后一个动作的中文描述.
 * @property {string} updatedAt 最后写入时间.
 */

/**
 * 创建初始化完成后的第一份状态.
 *
 * @param {object} options 创建参数.
 * @param {string} options.skillVersion 技能版本.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {NavigatorState} 初始状态.
 */
export function createInitialState({ skillVersion, now }) {
  return {
    schema: STATE_SCHEMA_VERSION,
    revision: 0,
    skillVersion,
    init: { status: INIT_ACTIVE, initializedAt: now },
    stage: STAGES.intake,
    project: { organization: null, verification: null, conventions: [] },
    milestones: [],
    current: null,
    decisions: [],
    next: { milestone: 1, slice: 1, decision: 1 },
    lastAction: "初始化",
    updatedAt: now,
  };
}

/**
 * 读取状态文件, 不判断结构版本.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {Record<string, any> | undefined} 文件内容; 文件不存在或不是合法 JSON 时为 undefined.
 * @throws {Error} 读取文件本身失败时.
 */
export function readRawState(projectRoot) {
  const file = path.join(projectRoot, STATE_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 判断读取到的内容是不是当前结构的状态.
 *
 * @param {Record<string, any> | undefined} raw 读取到的内容.
 * @returns {raw is NavigatorState} 是当前结构时返回 true.
 */
export function isCurrentState(raw) {
  return raw !== undefined && raw.schema === STATE_SCHEMA_VERSION;
}

/**
 * 读取当前结构的状态.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {NavigatorState | undefined} 状态; 文件不存在, 损坏或是更早的结构时为 undefined.
 */
export function readState(projectRoot) {
  const raw = readRawState(projectRoot);
  return isCurrentState(raw) ? raw : undefined;
}

/**
 * 原子写入状态文件. 写入前核对磁盘上的版本号, 写入时版本号加一.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {NavigatorState} state 要写入的状态, 其 revision 必须等于磁盘上的当前值.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {NavigatorState} 实际写入的状态.
 * @throws {StateConflictError} 当磁盘上的版本号与传入的不一致时.
 */
export function writeState(projectRoot, state, now) {
  const current = readState(projectRoot);
  if (current !== undefined && current.revision !== state.revision) {
    throw new StateConflictError(
      `state: 版本冲突, 磁盘为 ${current.revision}, 写入基于 ${state.revision}`,
    );
  }
  const next = { ...state, revision: state.revision + 1, updatedAt: now };
  writeJsonAtomically(path.join(projectRoot, STATE_FILE), next);
  return next;
}
