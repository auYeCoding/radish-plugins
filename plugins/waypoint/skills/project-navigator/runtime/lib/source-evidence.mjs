/**
 * @file 选型回执的源码证据: 读取回执中的证据表, 校验每条证据的写法,
 * 从原仓库取回被引用的行, 生成核对输出.
 *
 * 证据由执行会话写进回执; 验收子代理运行 evidence 命令, 从原仓库重新取源码核对,
 * 不依赖执行会话手中的副本. 取源码的细节在 source-fetch.mjs 中.
 */

import { EVIDENCE_COMMAND_NAME } from "./command-access.mjs";
import { readSectionTable, splitSections } from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
import { PROJECT_COMMAND_PATH } from "./paths.mjs";
import { fetchVersion, readSourceLines } from "./source-fetch.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 核对当前工单回执中全部证据的完整命令; 验收子代理原样运行.
 * @type {string}
 */
export const EVIDENCE_COMMAND = `node ${PROJECT_COMMAND_PATH} ${EVIDENCE_COMMAND_NAME}`;

/**
 * 核对单条证据的动作名, 执行会话写回执前自查时使用.
 * @type {string}
 */
export const EVIDENCE_CHECK_ACTION = "check";

/**
 * 回执中放源码证据的节, 与规格 files.receipt 选型结构中的节标题一致.
 * @type {string}
 */
export const EVIDENCE_SECTION = "能力核实";

/**
 * 证据表各列的列名, 与规格中该节表格的列一致, 顺序相同.
 * @type {Readonly<{capability: string, repository: string, version: string, path: string, lines: string, note: string}>}
 */
export const EVIDENCE_COLUMNS = Object.freeze({
  capability: "能力",
  repository: "仓库",
  version: "版本",
  path: "路径",
  lines: "行号",
  note: "说明",
});

/**
 * 一条证据最多引用的行数; 更长的范围应拆成多条, 每条对应一段完整的逻辑.
 * @type {number}
 */
export const MAX_EVIDENCE_LINES = 40;

/**
 * 仓库地址允许的协议: 只接受 https, 不接受本机路径与其它协议.
 * @type {string}
 */
const REPOSITORY_PROTOCOL = "https:";

/**
 * 版本的写法: tag, 分支或完整提交号, 不能以连字符开头.
 * @type {RegExp}
 */
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/u;

/**
 * 行号的写法: N 或 N-M.
 * @type {RegExp}
 */
const LINE_RANGE_PATTERN = /^(\d+)(?:-(\d+))?$/u;

/**
 * 输出源码行时, 每行前面的缩进.
 * @type {string}
 */
const SOURCE_LINE_INDENT = "    ";

/**
 * 整格是一个行内代码时的格式. 证据表的仓库, 版本与路径写在行内代码中,
 * 格式化工具不会改写其中的下划线等字符.
 * @type {RegExp}
 */
const CODE_SPAN_PATTERN = /^`([^`]+)`$/u;

/**
 * Markdown 的反斜杠转义: 反斜杠加一个 ASCII 标点.
 * @type {RegExp}
 */
const MARKDOWN_ESCAPE_PATTERN = /\\([!-/:-@[-`{-~])/gu;

/**
 * @typedef {object} EvidenceRow 一条源码证据, 对应证据表的一行.
 * @property {string} capability 证明的能力.
 * @property {string} repository 仓库地址.
 * @property {string} version 版本: tag, 分支或完整提交号.
 * @property {string} path 仓库中的文件路径.
 * @property {string} lines 行号, N 或 N-M.
 * @property {string} note 这几行代码证明了什么.
 */

/**
 * 从回执全文中读出证据表. 单元格写成行内代码时取其中的文字, 否则去掉 Markdown 转义.
 *
 * @param {string} receiptText 回执全文.
 * @returns {EvidenceRow[]} 各条证据.
 * @throws {WorkflowError} 回执中没有证据表, 或表头与规格不一致时.
 */
export function readEvidenceRows(receiptText) {
  const section = splitSections(parseMarkdown(receiptText)).sections.find(
    (entry) => entry.title === EVIDENCE_SECTION,
  );
  const table = section === undefined ? undefined : readSectionTable(section);
  const keys = Object.keys(EVIDENCE_COLUMNS);
  const columns = Object.values(EVIDENCE_COLUMNS);
  if (table === undefined || table.headers.join("|") !== columns.join("|")) {
    throw new WorkflowError(
      `回执的 "${EVIDENCE_SECTION}" 节中没有证据表, 表头应依次为 ${columns.join(", ")}.`,
    );
  }
  return table.rows.map(
    (row) =>
      /** @type {EvidenceRow} */ (
        Object.fromEntries(
          keys.map((key, index) => [key, cellText(row[index] ?? "")]),
        )
      ),
  );
}

/**
 * 取出单元格的文字: 整格是行内代码时取其中的内容, 否则去掉 Markdown 的反斜杠转义.
 *
 * @param {string} cell 单元格原文.
 * @returns {string} 文字.
 */
function cellText(cell) {
  const code = CODE_SPAN_PATTERN.exec(cell);
  return code === null ? cell.replace(MARKDOWN_ESCAPE_PATTERN, "$1") : code[1];
}

/**
 * 解析行号范围.
 *
 * @param {string} text 行号, N 或 N-M.
 * @returns {import("./source-fetch.mjs").LineRange | undefined} 范围; 写法不合格, 起始大于结束或超过行数上限时为 undefined.
 */
export function parseLineRange(text) {
  const match = LINE_RANGE_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  return start >= 1 && start <= end && end - start < MAX_EVIDENCE_LINES
    ? { start, end }
    : undefined;
}

/**
 * 找出一条证据在写法上的问题.
 *
 * @param {EvidenceRow} row 证据.
 * @returns {string | undefined} 问题; 写法合格时为 undefined.
 */
export function evidenceProblem(row) {
  if (!isHttpsAddress(row.repository)) {
    return `仓库应写 https 开头的公开仓库地址, 实际为 "${row.repository}".`;
  }
  if (!VERSION_PATTERN.test(row.version)) {
    return `版本应写仓库中的 tag, 分支或完整提交号, 实际为 "${row.version}".`;
  }
  if (!isRepositoryPath(row.path)) {
    return `路径应写仓库中以正斜杠分隔的相对路径, 实际为 "${row.path}".`;
  }
  if (parseLineRange(row.lines) === undefined) {
    return `行号应写 N 或 N-M, 起始不大于结束, 一条最多 ${MAX_EVIDENCE_LINES} 行, 实际为 "${row.lines}".`;
  }
  return undefined;
}

/**
 * 逐条核对证据: 先校验写法, 再从原仓库取回被引用的行. 同一仓库的同一版本
 * 在一次核对中只获取一次.
 *
 * @param {readonly EvidenceRow[]} rows 各条证据.
 * @param {string} cacheRoot 源码缓存目录.
 * @returns {import("./source-fetch.mjs").SourceResult[]} 与证据一一对应的结果: 取到的源码, 或写法不合格, 取不到的原因.
 * @throws {WorkflowError} 无法建立本地缓存时.
 */
export function verifyEvidenceRows(rows, cacheRoot) {
  /** @type {Map<string, import("./source-fetch.mjs").VersionResult>} */
  const versions = new Map();
  return rows.map((row) => {
    const problem = evidenceProblem(row);
    const range = parseLineRange(row.lines);
    if (problem !== undefined || range === undefined) {
      return { problem };
    }
    const key = JSON.stringify([row.repository, row.version]);
    if (!versions.has(key)) {
      versions.set(
        key,
        fetchVersion({
          cacheRoot,
          repository: row.repository,
          version: row.version,
        }),
      );
    }
    const { commit, problem: versionProblem } = versions.get(key) ?? {};
    return commit === undefined
      ? { problem: versionProblem }
      : readSourceLines({
          cacheRoot,
          repository: row.repository,
          commit,
          filePath: row.path,
          range,
        });
  });
}

/**
 * 生成一条证据的核对输出: 位置, 说明, 以及取到的源码或取不到的原因.
 *
 * @param {object} options 输出参数.
 * @param {number} options.index 证据序号, 从 1 开始.
 * @param {EvidenceRow} options.row 证据.
 * @param {import("./source-fetch.mjs").SourceExcerpt} [options.excerpt] 取到的源码.
 * @param {string} [options.problem] 取不到的原因.
 * @returns {string[]} 输出各行.
 */
export function formatEvidence({ index, row, excerpt, problem }) {
  const head = [
    `证据 ${index}: ${row.capability}`,
    `- 位置: ${row.repository} ${row.version} ${row.path}:${row.lines}`,
    `- 说明: ${row.note}`,
  ];
  if (excerpt === undefined) {
    return [...head, `- 结果: 取不到源码. ${problem ?? ""}`.trimEnd()];
  }
  const width = String(excerpt.lines.at(-1)?.number ?? 0).length;
  return [
    ...head,
    `- 提交: ${excerpt.commit}`,
    "- 源码:",
    ...excerpt.lines.map(
      (line) =>
        `${SOURCE_LINE_INDENT}${String(line.number).padStart(width)} | ${line.text}`,
    ),
  ];
}

/**
 * 判断仓库地址是否为 https 地址.
 *
 * @param {string} value 仓库地址.
 * @returns {boolean} 是 https 地址时返回 true.
 */
function isHttpsAddress(value) {
  return URL.canParse(value) && new URL(value).protocol === REPOSITORY_PROTOCOL;
}

/**
 * 判断路径是否为仓库中的相对路径: 正斜杠分隔, 不以斜杠或连字符开头, 不含上级目录.
 *
 * @param {string} value 路径.
 * @returns {boolean} 合格时返回 true.
 */
function isRepositoryPath(value) {
  return (
    value !== "" &&
    !value.startsWith("/") &&
    !value.startsWith("-") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}
