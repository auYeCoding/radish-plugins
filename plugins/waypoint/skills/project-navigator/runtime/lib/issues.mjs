/**
 * @file 遗留问题: 已做部分中还没有解决的事, 记在遗留问题文件的一张表里.
 *
 * 遗留问题与待办不同: 待办是还没有开始的新想法, 遗留问题是做过的部分欠下的事
 * (没有验证的结论, 待定标准, 已知缺陷, 推到以后某个切片的事). 编排会话直接编辑
 * 这个文件; 脚本只读表, 在切片通过, 放弃, 里程完成与收尾时拦下没有解决, 又没有
 * 切片负责的问题. 表的列名与状态写法只在这里定义.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomically } from "./atomic-file.mjs";
import { ISSUES_FILE } from "./paths.mjs";
import { findSlice, isSliceSettled } from "./roadmap.mjs";
import { parseTable, renderTable } from "./table.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 遗留问题表的列名.
 * @type {readonly string[]}
 */
export const ISSUE_COLUMNS = Object.freeze([
  "编号",
  "问题",
  "发现于",
  "归属切片",
  "状态",
  "处理结果",
]);

/**
 * 遗留问题的两种状态.
 * @type {Readonly<{open: string, resolved: string}>}
 */
export const ISSUE_STATUSES = Object.freeze({
  open: "未解决",
  resolved: "已解决",
});

/**
 * 遗留问题表中各列的下标.
 * @type {Readonly<{id: number, problem: number, foundIn: number, owner: number, status: number, resolution: number}>}
 */
const COLUMN = Object.freeze({
  id: 0,
  problem: 1,
  foundIn: 2,
  owner: 3,
  status: 4,
  resolution: 5,
});

/**
 * 表格行的格式: 以竖线开头, 与表格解析使用的判断一致.
 * @type {RegExp}
 */
const TABLE_ROW_PATTERN = /^\s*\|/u;

/**
 * 表格中表头与分隔行占用的行数.
 * @type {number}
 */
const TABLE_HEAD_ROWS = 2;

/**
 * 遗留问题文件的一级标题.
 * @type {string}
 */
const ISSUES_HEADING = "# 遗留问题";

/**
 * @typedef {object} Issue 遗留问题表的一行.
 * @property {string} id 编号.
 * @property {string} problem 问题.
 * @property {string} foundIn 发现于哪里, 例如切片编号或结论文件.
 * @property {string} owner 负责解决它的切片编号.
 * @property {string} status 状态, 见 ISSUE_STATUSES.
 * @property {string} resolution 处理结果.
 */

/**
 * @typedef {object} IssueList 读取到的遗留问题.
 * @property {Issue[]} issues 各行.
 * @property {string[]} problems 表格中不合规的地方.
 */

/**
 * 生成遗留问题文件的初始内容: 标题, 一行填写说明与空表.
 *
 * @returns {string} 文件全文.
 */
export function renderIssuesFile() {
  return [
    ISSUES_HEADING,
    "",
    `已做部分中还没有解决的事. 每个问题一行; "${ISSUE_COLUMNS[COLUMN.owner]}" 写负责解决它的切片编号; "${ISSUE_COLUMNS[COLUMN.status]}" 只写 ${ISSUE_STATUSES.open} 或 ${ISSUE_STATUSES.resolved}, ${ISSUE_STATUSES.resolved}时写明 "${ISSUE_COLUMNS[COLUMN.resolution]}". 新想法不写在这里, 写进待办.`,
    "",
    ...renderTable(ISSUE_COLUMNS, []),
    "",
  ].join("\n");
}

/**
 * 遗留问题文件不存在时写入初始内容.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {boolean} 本次新建了文件时返回 true.
 */
export function ensureIssuesFile(projectRoot) {
  const file = path.join(projectRoot, ISSUES_FILE);
  if (existsSync(file)) {
    return false;
  }
  writeFileAtomically(file, renderIssuesFile());
  return true;
}

/**
 * 读取遗留问题表. 文件不存在时视为没有遗留问题.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {IssueList} 各行与不合规的地方.
 */
export function readIssues(projectRoot) {
  const file = path.join(projectRoot, ISSUES_FILE);
  if (!existsSync(file)) {
    return { issues: [], problems: [] };
  }
  const lines = readFileSync(file, "utf8").replace(/\r\n?/gu, "\n").split("\n");
  const table = parseTable(lines);
  if (table === undefined) {
    return {
      issues: [],
      problems: [
        `${ISSUES_FILE} 中没有合法的表格: 表头为 ${ISSUE_COLUMNS.join(", ")}, 表头下要有分隔行.`,
      ],
    };
  }
  const issues = table.rows.map((cells) => ({
    id: cells[COLUMN.id] ?? "",
    problem: cells[COLUMN.problem] ?? "",
    foundIn: cells[COLUMN.foundIn] ?? "",
    owner: cells[COLUMN.owner] ?? "",
    status: cells[COLUMN.status] ?? "",
    resolution: cells[COLUMN.resolution] ?? "",
  }));
  const tableRowCount = lines.filter((line) =>
    TABLE_ROW_PATTERN.test(line),
  ).length;
  const strayRows = tableRowCount - TABLE_HEAD_ROWS - table.rows.length;
  return {
    issues,
    problems: [
      ...(strayRows > 0
        ? [
            `${ISSUES_FILE} 中有 ${strayRows} 行在表格之外, 不会被读到: 表格中间不能有空行或其它文字, 所有问题写在同一张表里.`,
          ]
        : []),
      ...issues.flatMap(issueProblems),
    ],
  };
}

/**
 * 取没有解决的遗留问题.
 *
 * @param {readonly Issue[]} issues 遗留问题.
 * @returns {Issue[]} 状态为未解决的问题.
 */
export function openIssues(issues) {
  return issues.filter((issue) => issue.status !== ISSUE_STATUSES.resolved);
}

/**
 * 取归属某个切片, 还没有解决的遗留问题.
 *
 * @param {readonly Issue[]} issues 遗留问题.
 * @param {string} sliceId 切片编号.
 * @returns {Issue[]} 归属该切片的未解决问题.
 */
export function issuesOwnedBy(issues, sliceId) {
  return openIssues(issues).filter((issue) => issue.owner === sliceId);
}

/**
 * 找出会被遗留下来的问题: 没有解决, 而归属的切片即将结束, 已经结束, 或不在路线中.
 *
 * @param {import("./state.mjs").NavigatorState} state 状态.
 * @param {readonly Issue[]} issues 遗留问题.
 * @param {string} [settlingId] 即将结束的切片编号; 没有时只看已经结束的切片.
 * @returns {Issue[]} 会被遗留下来的问题.
 */
export function strandedIssues(state, issues, settlingId) {
  return openIssues(issues).filter((issue) => {
    if (issue.owner === settlingId) {
      return true;
    }
    const found = findSlice(state, issue.owner);
    return found === undefined || isSliceSettled(found.slice);
  });
}

/**
 * 确认这一步之后不会留下遗留问题: 遗留问题表要合规, 归属即将结束的切片, 已经
 * 结束的切片或不在路线中的切片的问题都要已经解决.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {import("./state.mjs").NavigatorState} options.state 当前状态.
 * @param {string} options.step 这一步的说明, 用于拒绝理由, 例如 "切片 0003 通过".
 * @param {string} [options.settlingId] 即将结束的切片编号.
 * @returns {void}
 * @throws {WorkflowError} 表格不合规, 或有会被遗留下来的问题时.
 */
export function requireNoStrandedIssues({
  projectRoot,
  state,
  step,
  settlingId,
}) {
  const { issues, problems } = readIssues(projectRoot);
  if (problems.length > 0) {
    throw new WorkflowError(problems.join(" "));
  }
  const stranded = strandedIssues(state, issues, settlingId);
  if (stranded.length > 0) {
    throw new WorkflowError(
      `${ISSUES_FILE} 中有没有解决的遗留问题, 不能${step}: ${describeIssues(stranded)}. 解决后标为${ISSUE_STATUSES.resolved}并写明 "${ISSUE_COLUMNS[COLUMN.resolution]}"; 确实要等后面某个切片才能做的, 把 "${ISSUE_COLUMNS[COLUMN.owner]}" 改成那个还没有结束的切片.`,
    );
  }
}

/**
 * 把遗留问题写成一行列表, 用于命令输出与拒绝理由.
 *
 * @param {readonly Issue[]} issues 遗留问题.
 * @returns {string} 例如 "3 (帧下标为 -1 时取哪一帧), 5 (...)".
 */
export function describeIssues(issues) {
  return issues.map((issue) => `${issue.id} (${issue.problem})`).join("; ");
}

/**
 * 检查一行遗留问题是否合规.
 *
 * @param {Issue} issue 一行.
 * @param {number} index 行的下标.
 * @returns {string[]} 不合规的地方.
 */
function issueProblems(issue, index) {
  const where = `${ISSUES_FILE} 第 ${index + 1} 行`;
  const allowed = Object.values(ISSUE_STATUSES);
  return [
    ...(issue.id === "" || issue.problem === ""
      ? [
          `${where}: "${ISSUE_COLUMNS[COLUMN.id]}" 与 "${ISSUE_COLUMNS[COLUMN.problem]}" 不能为空.`,
        ]
      : []),
    ...(issue.owner === ""
      ? [`${where}: "${ISSUE_COLUMNS[COLUMN.owner]}" 要写负责解决它的切片编号.`]
      : []),
    ...(allowed.includes(issue.status)
      ? []
      : [
          `${where}: "${ISSUE_COLUMNS[COLUMN.status]}" 只能是 ${allowed.join(" 或 ")}.`,
        ]),
    ...(issue.status === ISSUE_STATUSES.resolved && issue.resolution === ""
      ? [`${where}: 已解决的问题要写明 "${ISSUE_COLUMNS[COLUMN.resolution]}".`]
      : []),
  ];
}
