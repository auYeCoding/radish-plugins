/**
 * @file 写作规则检查: 句长, 段落, 列表, 加粗, "的" 字, 黑话, 比喻, 翻译腔,
 * 句首裸指代词, 表格对齐与篇幅.
 *
 * 规则与阈值全部来自规格的 writing 一节. Stop 校验只采用 "问题" 级别的结果,
 * 体检同时报告 "问题" 与 "提示". 代码块不检查, 人类总结块除外.
 */

import { isSummaryBlock } from "./layout.mjs";
import { parseMarkdown } from "./markdown.mjs";
import { displayWidth } from "./table.mjs";
import { countUnits, plainText } from "./text-units.mjs";

/**
 * 列表项的格式: 缩进, 列表标记, 正文.
 * @type {RegExp}
 */
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/u;

/**
 * 表格行的格式: 以竖线开头.
 * @type {RegExp}
 */
const TABLE_ROW_PATTERN = /^\s*\|/u;

/**
 * 切分无标点片段的位置: 后接空白或行尾的英文标点, 括号, 引号, 表格竖线, 以及中文标点.
 * @type {RegExp}
 */
const PHRASE_BREAK_PATTERN =
  /[,.;:!?](?=\s|$)|[()"'|]|[、。，；：！？（）“”‘’]/u;

/**
 * 切分句子的位置: 后接空白或行尾的句末标点与冒号, 表格竖线, 以及中文句末标点.
 * @type {RegExp}
 */
const SENTENCE_BREAK_PATTERN = /[.;:!?](?=\s|$)|[|。；：！？]/u;

/**
 * 加粗文字.
 * @type {RegExp}
 */
const BOLD_PATTERN = /\*\*[^*]+\*\*/gu;

/**
 * 句首可以忽略的字符: 空白, 引号, 括号.
 * @type {RegExp}
 */
const SENTENCE_LEAD_PATTERN = /^[\s"'(“‘（]+/u;

/**
 * @typedef {object} WritingFinding 一条写作问题.
 * @property {string} label 类别, 4 个汉字.
 * @property {"problem" | "hint"} severity 级别.
 * @property {number} line 行号, 从 1 开始.
 * @property {string} message 说明, 写成可以照着改的中文句子.
 */

/**
 * @typedef {object} TextLine 参与检查的一行.
 * @property {"prose" | "list" | "table" | "heading" | "blank" | "block"} kind 行的种类.
 * @property {string} content 去掉列表标记后的正文; 标题, 空行与代码块为空字符串.
 * @property {string} raw 原始行.
 * @property {number} indent 列表项的缩进, 其它行为 0.
 * @property {number} line 行号, 从 1 开始.
 */

/**
 * 检查一段 Markdown 文本的写作规则.
 *
 * @param {object} options 检查参数.
 * @param {string} options.text Markdown 全文.
 * @param {import("./spec.mjs").TemplateSpec} options.spec 模板规格.
 * @param {number | undefined} options.maxLines 篇幅上限行数; 不限制时为 undefined.
 * @returns {WritingFinding[]} 按行号排序的问题.
 */
export function checkWriting({ text, spec, maxLines }) {
  const writing = spec.writing;
  const lines = collectLines(parseMarkdown(text), spec.format);
  const contentLines = lines.filter((line) => line.content !== "");
  return [
    ...contentLines.flatMap((line) => checkPhrases(line, writing)),
    ...contentLines.flatMap((line) => checkSentenceStarts(line, writing)),
    ...contentLines.flatMap((line) => checkWords(line, writing)),
    ...checkParagraphs(lines, writing),
    ...checkLists(lines, writing),
    ...checkBold(lines, writing),
    ...checkTables(lines, writing),
    ...checkLength(text, writing, maxLines),
  ].sort((first, second) => first.line - second.line);
}

/**
 * 把一条问题格式化为一行说明.
 *
 * @param {WritingFinding} finding 问题.
 * @returns {string} 说明文字.
 */
export function formatFinding(finding) {
  return `第 ${finding.line} 行, ${finding.label}: ${finding.message}`;
}

/**
 * 把解析结果展开成逐行的检查单元; 代码块只展开人类总结块的正文.
 *
 * @param {import("./markdown.mjs").MarkdownItem[]} items 解析结果.
 * @param {import("./spec.mjs").FormatSpec} format 全局版式规则.
 * @returns {TextLine[]} 各行.
 */
function collectLines(items, format) {
  return items.flatMap((item) => {
    if (item.kind === "heading") {
      return [lineOf("heading", "", item.text, item.line)];
    }
    if (item.kind === "block") {
      return isSummaryBlock(item, format)
        ? item.content
            .slice(1)
            .map((text, index) =>
              lineOf("prose", text.trim(), text, item.line + index + 2),
            )
        : [lineOf("block", "", "", item.line)];
    }
    return [classifyTextLine(item.text, item.line)];
  });
}

/**
 * 判断围栏之外一行的种类.
 *
 * @param {string} text 行内容.
 * @param {number} line 行号.
 * @returns {TextLine} 检查单元.
 */
function classifyTextLine(text, line) {
  if (text.trim() === "") {
    return lineOf("blank", "", text, line);
  }
  if (TABLE_ROW_PATTERN.test(text)) {
    return lineOf("table", text.trim(), text, line);
  }
  const listItem = LIST_ITEM_PATTERN.exec(text);
  if (listItem !== null) {
    return {
      ...lineOf("list", listItem[2], text, line),
      indent: listItem[1].length,
    };
  }
  return lineOf("prose", text.trim(), text, line);
}

/**
 * 构造检查单元.
 *
 * @param {TextLine["kind"]} kind 种类.
 * @param {string} content 正文.
 * @param {string} raw 原始行.
 * @param {number} line 行号.
 * @returns {TextLine} 检查单元.
 */
function lineOf(kind, content, raw, line) {
  return { kind, content, raw, indent: 0, line };
}

/**
 * 检查一行中每个无标点片段的字数与 "的" 字个数.
 *
 * @param {TextLine} line 检查单元.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkPhrases(line, writing) {
  const { sentence, particle } = writing;
  return plainText(line.content)
    .split(PHRASE_BREAK_PATTERN)
    .flatMap((phrase) => {
      const length = countUnits(phrase);
      const particles = [...phrase].filter(
        (character) => character === particle.character,
      ).length;
      const findings = [];
      if (length > sentence.maxLength) {
        findings.push(
          finding(
            sentence,
            line.line,
            `有一段 ${length} 字没有标点, 超过 ${sentence.maxLength} 字, 请拆成短句.`,
          ),
        );
      } else if (length >= sentence.hintLength) {
        findings.push({
          ...finding(
            sentence,
            line.line,
            `有一段 ${length} 字没有标点, 可以考虑拆句.`,
          ),
          severity: "hint",
        });
      }
      if (particles > particle.maxPerPhrase) {
        findings.push(
          finding(
            particle,
            line.line,
            `一个片段中有 ${particles} 个 "${particle.character}", 请拆开修饰语.`,
          ),
        );
      }
      return findings;
    });
}

/**
 * 检查每个句子的开头是否是没有名词的指代词.
 *
 * @param {TextLine} line 检查单元.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkSentenceStarts(line, writing) {
  const patterns = writing.pronoun.patterns.map(
    (pattern) => new RegExp(pattern, "u"),
  );
  return plainText(line.content)
    .split(SENTENCE_BREAK_PATTERN)
    .flatMap((sentence) => {
      const start = sentence.replace(SENTENCE_LEAD_PATTERN, "");
      const match = patterns
        .map((pattern) => pattern.exec(start))
        .find((result) => result !== null);
      return match === undefined
        ? []
        : [
            finding(
              writing.pronoun,
              line.line,
              `句首 "${match[0]}" 指代不明, 请写出具体名称.`,
            ),
          ];
    });
}

/**
 * 检查黑话, 比喻用词与翻译腔句式.
 *
 * @param {TextLine} line 检查单元.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkWords(line, writing) {
  const text = plainText(line.content);
  const { jargon, metaphor, translationese } = writing;
  return [
    ...jargon.words
      .filter((word) => text.includes(word))
      .map((word) =>
        finding(jargon, line.line, `"${word}" 属于黑话, 请改用具体说法.`),
      ),
    ...metaphor.words
      .filter((word) => text.includes(word))
      .map((word) =>
        finding(metaphor, line.line, `"${word}" 是比喻用词, 请直接说明事实.`),
      ),
    ...translationese.patterns.flatMap(({ pattern, advice }) => {
      const match = new RegExp(pattern, "u").exec(text);
      return match === null
        ? []
        : [finding(translationese, line.line, `"${match[0]}": ${advice}`)];
    }),
  ];
}

/**
 * 检查段落行数: 连续的普通文本行构成一个段落.
 *
 * @param {TextLine[]} lines 各行.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkParagraphs(lines, writing) {
  const { paragraph } = writing;
  const paragraphs = lines.reduce((groups, line) => {
    if (line.kind === "prose") {
      groups[groups.length - 1].push(line);
    } else if (groups[groups.length - 1].length > 0) {
      groups.push([]);
    }
    return groups;
  }, /** @type {TextLine[][]} */ ([[]]));
  return paragraphs
    .filter((group) => group.length > paragraph.maxLines)
    .map((group) =>
      finding(
        paragraph,
        group[0].line,
        `段落有 ${group.length} 行, 超过 ${paragraph.maxLines} 行, 请拆段或改成列表.`,
      ),
    );
}

/**
 * 检查列表: 同一层超过项数上限, 或嵌套超过层数上限. 空行不打断列表,
 * 其它非列表行打断列表.
 *
 * @param {TextLine[]} lines 各行.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkLists(lines, writing) {
  const { listLength, listDepth } = writing;
  const findings = [];
  let levels = [];
  for (const line of lines) {
    if (line.kind === "blank") {
      continue;
    }
    if (line.kind !== "list") {
      levels = [];
      continue;
    }
    levels = levels.filter((level) => level.indent <= line.indent);
    const current = levels[levels.length - 1];
    if (current === undefined || current.indent < line.indent) {
      levels = [...levels, { indent: line.indent, count: 1 }];
      if (levels.length === listDepth.maxDepth + 1) {
        findings.push(
          finding(
            listDepth,
            line.line,
            `列表嵌套超过 ${listDepth.maxDepth} 层, 请把深层内容拆成单独的节或表格.`,
          ),
        );
      }
      continue;
    }
    levels = [
      ...levels.slice(0, -1),
      { indent: current.indent, count: current.count + 1 },
    ];
    if (current.count + 1 === listLength.maxItems + 1) {
      findings.push(
        finding(
          listLength,
          line.line,
          `同一层列表超过 ${listLength.maxItems} 项, 请分组或改成表格.`,
        ),
      );
    }
  }
  return findings;
}

/**
 * 检查每节的加粗次数: 一级与二级标题划分节.
 *
 * @param {TextLine[]} lines 各行.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkBold(lines, writing) {
  const { bold } = writing;
  const sections = lines.reduce(
    (groups, line) => {
      if (line.kind === "heading") {
        groups.push({ line: line.line, count: 0 });
      } else {
        groups[groups.length - 1].count +=
          line.content.match(BOLD_PATTERN)?.length ?? 0;
      }
      return groups;
    },
    [{ line: 1, count: 0 }],
  );
  return sections
    .filter((section) => section.count > bold.maxPerSection)
    .map((section) =>
      finding(
        bold,
        section.line,
        `本节加粗 ${section.count} 处, 超过 ${bold.maxPerSection} 处, 加粗太多就失去了强调作用.`,
      ),
    );
}

/**
 * 检查表格源码是否对齐: 同一表格各行竖线的显示列位置一致.
 *
 * @param {TextLine[]} lines 各行.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {WritingFinding[]} 问题.
 */
function checkTables(lines, writing) {
  const tables = lines.reduce((groups, line, index) => {
    if (line.kind !== "table") {
      return groups;
    }
    if (lines[index - 1]?.kind === "table") {
      groups[groups.length - 1].push(line);
    } else {
      groups.push([line]);
    }
    return groups;
  }, /** @type {TextLine[][]} */ ([]));
  return tables
    .filter((rows) => {
      const layouts = rows.map((row) => pipeColumns(row.raw).join(","));
      return layouts.some((layout) => layout !== layouts[0]);
    })
    .map((rows) =>
      finding(
        writing.table,
        rows[0].line,
        "表格各行的竖线没有对齐, 请按显示宽度补齐空格 (一个汉字占两列).",
      ),
    );
}

/**
 * 计算一行中未转义竖线的显示列位置.
 *
 * @param {string} raw 表格行.
 * @returns {number[]} 各竖线的列位置.
 */
function pipeColumns(raw) {
  const characters = [...raw.trimEnd()];
  return characters.reduce(
    (state, character, index) => {
      const isPipe = character === "|" && characters[index - 1] !== "\\";
      return {
        width: state.width + displayWidth(character),
        columns: isPipe ? [...state.columns, state.width] : state.columns,
      };
    },
    { width: 0, columns: /** @type {number[]} */ ([]) },
  ).columns;
}

/**
 * 检查全文非空行数是否超过篇幅上限.
 *
 * @param {string} text 全文.
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @param {number | undefined} maxLines 篇幅上限.
 * @returns {WritingFinding[]} 问题.
 */
function checkLength(text, writing, maxLines) {
  if (maxLines === undefined) {
    return [];
  }
  const count = text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "").length;
  return count > maxLines
    ? [
        finding(
          writing.length,
          1,
          `全文 ${count} 行, 超过 ${maxLines} 行, 请删减重复内容或拆分文件.`,
        ),
      ]
    : [];
}

/**
 * 按规则的类别与级别构造一条问题.
 *
 * @param {import("./spec.mjs").WritingRule} rule 规则.
 * @param {number} line 行号.
 * @param {string} message 说明.
 * @returns {WritingFinding} 问题.
 */
function finding(rule, line, message) {
  return { label: rule.label, severity: rule.severity, line, message };
}
