/**
 * @file 切片文件的骨架, 读取与摘要.
 *
 * 一个切片一份文件, 分计划, 执行结果, 验收三段, 段名与小节名取自规格
 * `spec/slice.json`. 脚本只读取推进流程需要的内容: 完成标准, 需要决定, 执行状态,
 * 标准核对表与用户结论; 其余自由书写. 段的归属靠计划段的摘要保证: 开工时记下
 * 摘要, 送验时比对.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseMarkdown } from "./markdown.mjs";
import { SLICE_SPEC_FILE } from "./paths.mjs";
import { parseTable, renderTable } from "./table.mjs";

/**
 * 段标题的级别.
 * @type {number}
 */
const PART_LEVEL = 2;

/**
 * 小节标题的级别.
 * @type {number}
 */
const SECTION_LEVEL = 3;

/**
 * 段的编号.
 * @type {Readonly<{plan: string, result: string, review: string}>}
 */
export const PARTS = Object.freeze({
  plan: "plan",
  result: "result",
  review: "review",
});

/**
 * 脚本与委派提示词引用的小节的编号, 与规格中的 `id` 一致.
 * @type {Readonly<Record<string, string>>}
 */
export const SECTIONS = Object.freeze({
  criteria: "criteria",
  excluded: "excluded",
  decisions: "decisions",
  modules: "modules",
  rework: "rework",
  status: "status",
  changes: "changes",
  wiring: "wiring",
  corrections: "corrections",
  pending: "pending",
  tests: "tests",
  notes: "notes",
  verdicts: "verdicts",
  wiringCheck: "wiringCheck",
  structure: "structure",
  scope: "scope",
  correctionCheck: "correctionCheck",
  manual: "manual",
  conclusion: "conclusion",
});

/**
 * 完成标准列表项的格式: 编号, 点, 内容.
 * @type {RegExp}
 */
const NUMBERED_ITEM_PATTERN = /^\s*\d+\.\s+(.+)$/u;

/**
 * 标准核对表中各列的下标.
 * @type {Readonly<{criterion: number, verdict: number, evidence: number}>}
 */
const VERDICT_COLUMNS = Object.freeze({
  criterion: 0,
  verdict: 1,
  evidence: 2,
});

/**
 * 标准核对结论的三种归类.
 * @type {Readonly<{pass: string, unverified: string, fail: string}>}
 */
export const VERDICT_CLASSES = Object.freeze({
  pass: "pass",
  unverified: "unverified",
  fail: "fail",
});

/**
 * @typedef {object} SectionSpec 一个小节的规格.
 * @property {string} id 小节编号.
 * @property {string} title 小节标题.
 * @property {string} [hint] 骨架中的填写提示.
 * @property {string} [initial] 骨架中的初始内容, 代替占位.
 * @property {string[]} [kinds] 只在这些切片种类中出现; 省略时都出现.
 * @property {string[]} [table] 表格的列名.
 * @property {string[]} [keys] 表格之后的键值行的键名.
 */

/**
 * @typedef {object} PartSpec 一段的规格.
 * @property {string} id 段编号.
 * @property {string} heading 段标题.
 * @property {string} owner 负责写这一段的角色.
 * @property {SectionSpec[]} sections 小节.
 */

/**
 * @typedef {object} SliceSpec 切片文件的规格.
 * @property {string} titlePrefix 一级标题的前缀.
 * @property {string} placeholder 占位内容的开头.
 * @property {string} none 表示 "没有" 的写法.
 * @property {string} doneStatus 执行状态中表示做完的写法.
 * @property {string} reworkStatus 补做期间脚本写入执行状态的内容.
 * @property {{pass: string, fail: string, unverified: string}} verdicts 标准核对的三种结论.
 * @property {PartSpec[]} parts 各段.
 */

/**
 * @typedef {object} ParsedPart 解析出的一段.
 * @property {number} start 段标题所在行的下标.
 * @property {number} end 段的最后一行之后的下标.
 * @property {Record<string, string[]>} sections 各小节的内容行, 键为小节标题.
 */

/**
 * @typedef {object} ParsedSlice 解析出的切片文件.
 * @property {string[]} lines 全文各行.
 * @property {Record<string, ParsedPart>} parts 各段, 键为段编号; 文件中没有的段不在其中.
 */

/**
 * @typedef {object} VerdictRow 标准核对表的一行.
 * @property {string} criterion 标准.
 * @property {string} verdict 结论.
 * @property {string} evidence 证据.
 */

/**
 * 读取切片文件的规格.
 *
 * @returns {SliceSpec} 规格.
 */
export function loadSliceSpec() {
  return JSON.parse(readFileSync(SLICE_SPEC_FILE, "utf8"));
}

/**
 * 取某一段的规格.
 *
 * @param {SliceSpec} spec 规格.
 * @param {string} partId 段编号.
 * @returns {PartSpec} 段的规格.
 */
export function partSpec(spec, partId) {
  return /** @type {PartSpec} */ (
    spec.parts.find((part) => part.id === partId)
  );
}

/**
 * 取某个小节的标题.
 *
 * @param {SliceSpec} spec 规格.
 * @param {string} sectionId 小节编号.
 * @returns {string} 小节标题.
 */
export function sectionTitle(spec, sectionId) {
  const section = spec.parts
    .flatMap((part) => part.sections)
    .find((entry) => entry.id === sectionId);
  return /** @type {SectionSpec} */ (section).title;
}

/**
 * 列出某一段在某种切片中出现的小节.
 *
 * @param {PartSpec} part 段的规格.
 * @param {string} kind 切片种类.
 * @returns {SectionSpec[]} 小节.
 */
export function sectionsFor(part, kind) {
  return part.sections.filter(
    (section) => section.kinds === undefined || section.kinds.includes(kind),
  );
}

/**
 * 生成一段的骨架.
 *
 * @param {SliceSpec} spec 规格.
 * @param {string} partId 段编号.
 * @param {string} kind 切片种类.
 * @returns {string[]} 骨架各行, 以段标题开头.
 */
export function renderPart(spec, partId, kind) {
  const part = partSpec(spec, partId);
  return [
    `${"#".repeat(PART_LEVEL)} ${part.heading}`,
    "",
    ...sectionsFor(part, kind).flatMap((section) => [
      `${"#".repeat(SECTION_LEVEL)} ${section.title}`,
      "",
      ...sectionBody(spec, section),
      "",
    ]),
  ];
}

/**
 * 生成整份切片文件的骨架.
 *
 * @param {object} options 生成参数.
 * @param {SliceSpec} options.spec 规格.
 * @param {{id: string, name: string, kind: string}} options.slice 切片.
 * @param {string} options.summary 标题下方的一行说明.
 * @returns {string} 文件全文.
 */
export function renderSliceFile({ spec, slice, summary }) {
  return [
    `# ${spec.titlePrefix} ${slice.id}: ${slice.name}`,
    "",
    summary,
    "",
    ...spec.parts.flatMap((part) => renderPart(spec, part.id, slice.kind)),
  ]
    .join("\n")
    .replace(/\n+$/u, "\n");
}

/**
 * 读取并解析切片文件.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {string | null} relativeFile 切片文件的项目相对路径.
 * @param {SliceSpec} spec 规格.
 * @returns {ParsedSlice | undefined} 解析结果; 文件不存在时为 undefined.
 */
export function readSliceFile(projectRoot, relativeFile, spec) {
  if (relativeFile === null) {
    return undefined;
  }
  const file = path.join(projectRoot, relativeFile);
  return existsSync(file)
    ? parseSliceFile(readFileSync(file, "utf8"), spec)
    : undefined;
}

/**
 * 解析切片文件: 按段标题与小节标题切分. 同名的段取最后一个, 补做时归档的旧段
 * 标题带轮次, 不会重名.
 *
 * @param {string} text 文件全文.
 * @param {SliceSpec} spec 规格.
 * @returns {ParsedSlice} 解析结果.
 */
export function parseSliceFile(text, spec) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const headings = parseMarkdown(text).filter(
    (item) => item.kind === "heading",
  );
  const partHeadings = headings.filter((item) => item.level === PART_LEVEL);
  /** @type {Record<string, ParsedPart>} */
  const parts = {};
  for (const part of spec.parts) {
    const heading = partHeadings.findLast((item) => item.text === part.heading);
    if (heading === undefined) {
      continue;
    }
    const following = partHeadings.find((item) => item.line > heading.line);
    const end = following === undefined ? lines.length : following.line - 1;
    parts[part.id] = {
      start: heading.line - 1,
      end,
      sections: readSections(lines, headings, heading.line, end),
    };
  }
  return { lines, parts };
}

/**
 * 计算计划段的摘要. 先去掉行首尾空白, 合并连续空白, 统一表格分隔行的长度,
 * 格式化工具重排表格时摘要不变.
 *
 * @param {ParsedSlice} parsed 解析结果.
 * @returns {string | undefined} 摘要; 文件中没有计划段时为 undefined.
 */
export function digestPlan(parsed) {
  const part = parsed.parts[PARTS.plan];
  if (part === undefined) {
    return undefined;
  }
  const normalized = parsed.lines
    .slice(part.start, part.end)
    .map((line) => line.trim().replace(/\s+/gu, " ").replace(/-{3,}/gu, "---"))
    .filter((line) => line !== "")
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * 找出某一段中还没有填写的小节: 缺少小节, 小节为空, 或仍有占位内容.
 *
 * @param {object} options 参数.
 * @param {ParsedSlice} options.parsed 解析结果.
 * @param {SliceSpec} options.spec 规格.
 * @param {string} options.partId 段编号.
 * @param {string} options.kind 切片种类.
 * @param {readonly string[]} [options.except] 不检查的小节编号.
 * @returns {string[]} 没有填写的小节标题; 整段缺失时为段标题.
 */
export function findUnfilledSections({
  parsed,
  spec,
  partId,
  kind,
  except = [],
}) {
  const part = partSpec(spec, partId);
  const found = parsed.parts[partId];
  if (found === undefined) {
    return [part.heading];
  }
  return sectionsFor(part, kind)
    .filter((section) => !except.includes(section.id))
    .filter((section) => {
      const content = meaningfulLines(found.sections[section.title]);
      return (
        content.length === 0 ||
        content.some((line) => line.includes(spec.placeholder))
      );
    })
    .map((section) => section.title);
}

/**
 * 读取完成标准.
 *
 * @param {ParsedSlice} parsed 解析结果.
 * @param {SliceSpec} spec 规格.
 * @returns {string[]} 各条标准的内容.
 */
export function readCriteria(parsed, spec) {
  return sectionLines(parsed, spec, PARTS.plan, SECTIONS.criteria)
    .map((line) => NUMBERED_ITEM_PATTERN.exec(line))
    .filter((match) => match !== null)
    .map((match) => match[1].trim());
}

/**
 * 判断计划段的某个小节是否只写了 "无".
 *
 * @param {ParsedSlice} parsed 解析结果.
 * @param {SliceSpec} spec 规格.
 * @param {string} sectionId 小节编号.
 * @returns {boolean} 小节只有一行 "无" 时返回 true.
 */
export function isPlanSectionNone(parsed, spec, sectionId) {
  const content = sectionLines(parsed, spec, PARTS.plan, sectionId);
  return content.length === 1 && stripMark(content[0]) === spec.none;
}

/**
 * 读取执行状态.
 *
 * @param {ParsedSlice | undefined} parsed 解析结果.
 * @param {SliceSpec} spec 规格.
 * @returns {string} 执行状态的第一行; 没有写或仍是占位时为空字符串.
 */
export function readResultStatus(parsed, spec) {
  if (parsed === undefined) {
    return "";
  }
  const [first = ""] = sectionLines(
    parsed,
    spec,
    PARTS.result,
    SECTIONS.status,
  );
  return first.includes(spec.placeholder) ? "" : stripMark(first);
}

/**
 * 读取标准核对表.
 *
 * @param {ParsedSlice | undefined} parsed 解析结果.
 * @param {SliceSpec} spec 规格.
 * @returns {{rows: VerdictRow[], problems: string[]}} 表格各行与读取中发现的问题; 表格还没有填写时两者都为空.
 */
export function readVerdicts(parsed, spec) {
  if (parsed === undefined) {
    return { rows: [], problems: [] };
  }
  const content = sectionLines(parsed, spec, PARTS.review, SECTIONS.verdicts);
  const table = parseTable(content);
  if (
    table === undefined ||
    content.some((line) => line.includes(spec.placeholder))
  ) {
    return { rows: [], problems: [] };
  }
  const allowed = Object.values(spec.verdicts);
  const rows = table.rows.map((cells) => ({
    criterion: cells[VERDICT_COLUMNS.criterion] ?? "",
    verdict: cells[VERDICT_COLUMNS.verdict] ?? "",
    evidence: cells[VERDICT_COLUMNS.evidence] ?? "",
  }));
  const title = sectionTitle(spec, SECTIONS.verdicts);
  const problems = rows.flatMap((row, index) => [
    ...(allowed.includes(row.verdict)
      ? []
      : [
          `"${title}" 第 ${index + 1} 行的结论 "${row.verdict}" 只能是 ${allowed.join(", ")} 之一.`,
        ]),
    ...(row.evidence === "" ? [`"${title}" 第 ${index + 1} 行没有证据.`] : []),
  ]);
  return { rows, problems };
}

/**
 * 给标准核对的结果归类: 有不通过的归为不通过, 否则有未验证的归为未验证.
 *
 * @param {readonly VerdictRow[]} rows 标准核对表各行.
 * @param {SliceSpec} spec 规格.
 * @returns {string} 归类, 见 VERDICT_CLASSES.
 */
export function classifyVerdicts(rows, spec) {
  if (rows.some((row) => row.verdict === spec.verdicts.fail)) {
    return VERDICT_CLASSES.fail;
  }
  return rows.some((row) => row.verdict === spec.verdicts.unverified)
    ? VERDICT_CLASSES.unverified
    : VERDICT_CLASSES.pass;
}

/**
 * 把执行状态改成补做中, 并把现有的验收段归档, 在文末追加一段空的验收段.
 *
 * @param {object} options 参数.
 * @param {string} options.text 文件全文.
 * @param {SliceSpec} options.spec 规格.
 * @param {string} options.kind 切片种类.
 * @param {number} options.round 刚结束的轮次.
 * @returns {string} 新的文件全文.
 */
export function prepareRework({ text, spec, kind, round }) {
  const parsed = parseSliceFile(text, spec);
  const lines = [...parsed.lines];
  const review = parsed.parts[PARTS.review];
  if (review !== undefined) {
    lines[review.start] = `${lines[review.start].trimEnd()} (第 ${round} 轮)`;
  }
  const statusTitle = sectionTitle(spec, SECTIONS.status);
  const result = parsed.parts[PARTS.result];
  if (result !== undefined) {
    const heading = lines.findIndex(
      (line, index) =>
        index > result.start &&
        index < result.end &&
        line.trim() === `${"#".repeat(SECTION_LEVEL)} ${statusTitle}`,
    );
    const first = lines.findIndex(
      (line, index) => index > heading && line.trim() !== "",
    );
    if (heading >= 0 && first >= 0 && first < result.end) {
      lines[first] = spec.reworkStatus;
    }
  }
  return [
    lines.join("\n").replace(/\n+$/u, ""),
    "",
    ...renderPart(spec, PARTS.review, kind),
  ]
    .join("\n")
    .replace(/\n+$/u, "\n");
}

/**
 * 生成一个小节在骨架中的内容.
 *
 * @param {SliceSpec} spec 规格.
 * @param {SectionSpec} section 小节的规格.
 * @returns {string[]} 内容各行.
 */
function sectionBody(spec, section) {
  const blank = `${spec.placeholder})`;
  if (section.initial !== undefined) {
    return [section.initial];
  }
  if (section.table === undefined) {
    return [`${spec.placeholder}: ${section.hint})`];
  }
  return [
    ...renderTable(section.table, [section.table.map(() => blank)]),
    ...(section.keys === undefined
      ? []
      : ["", ...section.keys.map((key) => `- ${key}: ${blank}`)]),
  ];
}

/**
 * 按小节标题切分一段的内容.
 *
 * @param {readonly string[]} lines 全文各行.
 * @param {readonly import("./markdown.mjs").MarkdownItem[]} headings 全文的标题.
 * @param {number} partLine 段标题的行号, 从 1 开始.
 * @param {number} end 段的最后一行之后的下标.
 * @returns {Record<string, string[]>} 各小节的内容行.
 */
function readSections(lines, headings, partLine, end) {
  const inside = headings.filter(
    (item) =>
      item.kind === "heading" &&
      item.level === SECTION_LEVEL &&
      item.line > partLine &&
      item.line <= end,
  );
  return Object.fromEntries(
    inside.map((heading, index) => [
      /** @type {import("./markdown.mjs").HeadingItem} */ (heading).text,
      lines.slice(
        heading.line,
        index + 1 < inside.length ? inside[index + 1].line - 1 : end,
      ),
    ]),
  );
}

/**
 * 取某个小节中有内容的行.
 *
 * @param {ParsedSlice} parsed 解析结果.
 * @param {SliceSpec} spec 规格.
 * @param {string} partId 段编号.
 * @param {string} sectionId 小节编号.
 * @returns {string[]} 去掉首尾空白的非空行; 段或小节不存在时为空.
 */
function sectionLines(parsed, spec, partId, sectionId) {
  return meaningfulLines(
    parsed.parts[partId]?.sections[sectionTitle(spec, sectionId)],
  );
}

/**
 * 去掉空行与行首尾空白.
 *
 * @param {readonly string[] | undefined} lines 内容行.
 * @returns {string[]} 有内容的行.
 */
function meaningfulLines(lines) {
  return (lines ?? []).map((line) => line.trim()).filter((line) => line !== "");
}

/**
 * 去掉一行开头的列表符号与结尾的句号, 用于比较单行的取值.
 *
 * @param {string} line 一行内容.
 * @returns {string} 取值.
 */
function stripMark(line) {
  return line.replace(/^[-*]\s+/u, "").replace(/\.$/u, "");
}
