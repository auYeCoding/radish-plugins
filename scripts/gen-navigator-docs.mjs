/**
 * @file 从 project-navigator 的模板规格生成参考文档与执行手册.
 *
 * 用法: node scripts/gen-navigator-docs.mjs [--check]
 *
 * 回复类型, 记录文件与写作规则的唯一来源是 `spec/templates.json`; 标点规则的唯一
 * 来源是 `shared/punctuation.md`. 本脚本把它们写进技能的参考文档与执行手册,
 * 手写的说明文字放在 `scripts/navigator-docs/` 中, 以占位行标出生成内容的位置.
 * 生成结果经过 prettier 格式化; `--check` 只比较不写入, 有差异时以退出码 1 结束.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as prettier from "prettier";

import {
  OPTION_LETTERS,
  renderOptionBlock,
} from "../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import { renderTable } from "../plugins/waypoint/skills/project-navigator/runtime/lib/table.mjs";

/**
 * 仓库根目录的绝对路径.
 * @type {string}
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * 技能目录的绝对路径.
 * @type {string}
 */
const SKILL_DIRECTORY = path.join(
  REPO_ROOT,
  "plugins",
  "waypoint",
  "skills",
  "project-navigator",
);

/**
 * 手写说明文字所在目录.
 * @type {string}
 */
const SOURCE_DIRECTORY = path.join(REPO_ROOT, "scripts", "navigator-docs");

/**
 * 模板规格文件.
 * @type {string}
 */
const SPEC_FILE = path.join(SKILL_DIRECTORY, "spec", "templates.json");

/**
 * 标点规则文件.
 * @type {string}
 */
const PUNCTUATION_FILE = path.join(
  REPO_ROOT,
  "plugins",
  "waypoint",
  "shared",
  "punctuation.md",
);

/**
 * 插入在生成文件一级标题之后的说明.
 * @type {string}
 */
const GENERATED_NOTICE =
  "<!-- 本文件由 scripts/gen-navigator-docs.mjs 生成, 不要直接修改; 请修改规格或 scripts/navigator-docs/ 中的源文件后重新生成. -->";

/**
 * 源文件中标记生成内容位置的占位行.
 * @type {RegExp}
 */
const PLACEHOLDER_PATTERN = /^<!-- generate: ([a-z-]+) -->$/gmu;

/**
 * 只比较不写入的参数.
 * @type {string}
 */
const CHECK_FLAG = "--check";

/**
 * 生成结果与已有文件不一致时的退出码.
 * @type {number}
 */
const EXIT_FAILURE = 1;

/**
 * 回复使用方的显示名.
 * @type {Readonly<Record<string, string>>}
 */
const ROLE_LABELS = Object.freeze({
  orchestrator: "编排会话",
  executor: "执行会话",
});

/**
 * 级别的显示名.
 * @type {Readonly<Record<string, string>>}
 */
const SEVERITY_LABELS = Object.freeze({ problem: "问题", hint: "提示" });

/**
 * @typedef {object} GenerationContext 生成内容需要的输入.
 * @property {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @property {string} punctuation 标点规则原文.
 */

/**
 * 占位行名称及其生成函数.
 * @type {Readonly<Record<string, (context: GenerationContext) => string[]>>}
 */
const GENERATORS = Object.freeze({
  "executor-replies": ({ spec }) => executorReplySummaries(spec),
  "test-boundary": ({ spec }) => testBoundaryBlock(spec),
  "receipt-structures": ({ spec }) => receiptStructures(spec),
  punctuation: ({ punctuation }) => punctuationRules(punctuation),
  "writing-rules": ({ spec }) => writingRulesTable(spec),
  "writing-words": ({ spec }) => writingWords(spec),
});

/**
 * 生成目标, 相对于技能目录: 由源文件填充占位行, 或完全由规格生成.
 * @type {readonly {target: string, source?: string, render?: (context: GenerationContext) => string}[]}
 */
const OUTPUTS = Object.freeze([
  { target: "references/replies.md", render: repliesDocument },
  { target: "references/files.md", render: filesDocument },
  { target: "references/writing.md", source: "writing.md" },
  { target: "guide/executor.md", source: "executor-guide.md" },
]);

/**
 * 生成全部文档; 检查模式下只报告与已有文件不一致的目标.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const isCheck = process.argv.includes(CHECK_FLAG);
  const context = {
    spec: JSON.parse(readFileSync(SPEC_FILE, "utf8")),
    punctuation: readFileSync(PUNCTUATION_FILE, "utf8"),
  };
  const stale = [];
  for (const output of OUTPUTS) {
    const file = path.join(SKILL_DIRECTORY, output.target);
    const content = await formatMarkdown(file, buildDocument(output, context));
    const existing = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    if (existing === content) {
      continue;
    }
    if (isCheck) {
      stale.push(output.target);
    } else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content, "utf8");
      console.log(`已生成 ${output.target}`);
    }
  }
  if (stale.length > 0) {
    console.error(
      `以下文件与规格不一致, 请运行 npm run gen:docs: ${stale.join(", ")}`,
    );
    process.exitCode = EXIT_FAILURE;
  }
}

/**
 * 生成一个目标文档的全文, 并在一级标题之后插入生成说明.
 *
 * @param {{target: string, source?: string, render?: (context: GenerationContext) => string}} output 生成目标.
 * @param {GenerationContext} context 生成输入.
 * @returns {string} 文档全文.
 * @throws {Error} 源文件中出现未知的占位行时.
 */
function buildDocument(output, context) {
  const body =
    output.render === undefined
      ? fillPlaceholders(
          readFileSync(
            path.join(SOURCE_DIRECTORY, output.source ?? ""),
            "utf8",
          ),
          context,
        )
      : output.render(context);
  const [title, ...rest] = body.split("\n");
  return [title, "", GENERATED_NOTICE, ...rest].join("\n");
}

/**
 * 把源文件中的占位行替换为生成内容.
 *
 * @param {string} source 源文件全文.
 * @param {GenerationContext} context 生成输入.
 * @returns {string} 替换后的全文.
 * @throws {Error} 占位行名称未知时.
 */
function fillPlaceholders(source, context) {
  return source.replace(PLACEHOLDER_PATTERN, (_line, name) => {
    if (!Object.hasOwn(GENERATORS, name)) {
      throw new Error(`gen-navigator-docs: 未知的占位行 "${name}"`);
    }
    return GENERATORS[name](context).join("\n");
  });
}

/**
 * 用仓库的 prettier 配置格式化 Markdown.
 *
 * @param {string} file 目标文件路径, 用于解析配置.
 * @param {string} content 文档全文.
 * @returns {Promise<string>} 格式化后的全文.
 */
async function formatMarkdown(file, content) {
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(content, { ...options, filepath: file });
}

/**
 * 生成回复类型参考文档.
 *
 * @param {GenerationContext} context 生成输入.
 * @returns {string} 文档全文.
 */
function repliesDocument({ spec }) {
  const groups = Object.keys(ROLE_LABELS).flatMap((role) => [
    "",
    `## ${ROLE_LABELS[role]}的回复`,
    ...Object.entries(spec.replies)
      .filter(([, reply]) => reply.role === role)
      .flatMap(([title, reply]) => ["", ...replySummary(title, reply, spec)]),
  ]);
  return [
    "# 回复类型",
    "",
    `每条回复都以 "# 类型" 开头, 第一节固定为 "## ${spec.format.progressTitle}", 结尾依次是一个选项块与一个人类总结块. 回复前运行 \`reply <编号> --option <组号>\` 取得骨架, 按骨架填写.`,
    ...groups,
    "",
  ].join("\n");
}

/**
 * 生成一种回复的摘要: 编号, 各节与键名, 各组选项.
 *
 * @param {string} title 回复类型.
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").ReplySpec} reply 回复规格.
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 各行.
 */
function replySummary(title, reply, spec) {
  return [
    `### ${title}`,
    "",
    `- 编号: \`${reply.id}\``,
    `- 各节: ${[{ title: spec.format.progressTitle, keys: spec.format.progressKeys }, ...reply.sections].map(sectionLabel).join("; ")}`,
    "- 选项:",
    ...reply.optionSets.map(
      (set, index) =>
        `  - 第 ${index + 1} 组 [${set.title}]: ${set.choices.map((choice, choiceIndex) => `${OPTION_LETTERS[choiceIndex]}. ${choice}`).join(" ")}`,
    ),
  ];
}

/**
 * 描述一个节: 标题, 键名, 是否放启动提示词.
 *
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").SectionSpec} section 节规格.
 * @returns {string} 描述.
 */
function sectionLabel(section) {
  const keys =
    section.keys === undefined ? "" : ` (${section.keys.join(", ")})`;
  const launch = section.allowLaunchPrompt === true ? " (放启动提示词)" : "";
  return `${section.title}${keys}${launch}`;
}

/**
 * 生成记录文件参考文档.
 *
 * @param {GenerationContext} context 生成输入.
 * @returns {string} 文档全文.
 */
function filesDocument({ spec }) {
  return [
    "# 记录文件",
    "",
    `\`.navigator/\` 下的记录文件在写入前按以下结构校验, 不合格的写入会被拒绝. 新建文件前运行 \`template <种类>\` 取得骨架. 每个文件以一级标题开头, 以人类总结块结尾.`,
    ...Object.entries(spec.files).flatMap(([kind, fileSpec]) => [
      "",
      `## ${fileSpec.title}`,
      "",
      `- 种类: \`${kind}\``,
      `- 路径: \`${fileSpec.pattern}\``,
      `- 当前进展: ${fileSpec.hasProgress === true ? "有" : "无"}`,
      ...(fileSpec.variants ?? [fileSpec.sections ?? []]).map(
        (sections, index, all) =>
          `- 固定节${all.length > 1 ? ` (结构 ${index + 1})` : ""}: ${sections.map(sectionLabel).join("; ") || "无"}`,
      ),
      ...(fileSpec.entryPattern === undefined
        ? []
        : [`- 条目标题: 匹配 \`${fileSpec.entryPattern}\`, 只追加不修改`]),
      ...(fileSpec.entryKeys === undefined
        ? []
        : [`- 条目键名: ${fileSpec.entryKeys.join(", ")}`]),
      ...(fileSpec.closingSections === undefined
        ? []
        : [
            `- 收尾节: ${fileSpec.closingSections.map(sectionLabel).join("; ")}`,
          ]),
    ]),
    "",
  ].join("\n");
}

/**
 * 生成执行会话三种回复的摘要.
 *
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 各行.
 */
function executorReplySummaries(spec) {
  return Object.entries(spec.replies)
    .filter(([, reply]) => reply.role === "executor")
    .flatMap(([title, reply]) => [...replySummary(title, reply, spec), ""]);
}

/**
 * 生成测试边界的固定选项块, 取自 "测试授权" 的第一组选项.
 *
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 各行.
 */
function testBoundaryBlock(spec) {
  return renderOptionBlock(spec.replies["测试授权"].optionSets[0]);
}

/**
 * 生成回执的两种结构说明.
 *
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 各行.
 */
function receiptStructures(spec) {
  const names = ["实现类工单", "选型类工单"];
  return [
    `回执以 "# ${spec.files.receipt.title}" 开头, 第一节为 "## ${spec.format.progressTitle}", 以人类总结块结尾. 中间各节:`,
    "",
    ...spec.files.receipt.variants.map(
      (sections, index) =>
        `- ${names[index] ?? `结构 ${index + 1}`} (\`--option ${index + 1}\`): ${sections.map(sectionLabel).join("; ")}`,
    ),
  ];
}

/**
 * 取出标点规则的条目.
 *
 * @param {string} punctuation 标点规则原文.
 * @returns {string[]} 规则各行.
 */
function punctuationRules(punctuation) {
  return punctuation.split("\n").filter((line) => line.startsWith("- "));
}

/**
 * 生成写作规则表.
 *
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 表格各行.
 */
function writingRulesTable(spec) {
  const writing = spec.writing;
  const descriptions = {
    structure: "记录文件的标题, 节与键名不符合规格",
    sentence: `没有标点的片段超过 ${writing.sentence.maxLength} 字; 达到 ${writing.sentence.hintLength} 字时给出提示`,
    paragraph: `连续的普通文本超过 ${writing.paragraph.maxLines} 行`,
    listLength: `同一层列表超过 ${writing.listLength.maxItems} 项`,
    listDepth: `列表嵌套超过 ${writing.listDepth.maxDepth} 层`,
    bold: `一节中加粗超过 ${writing.bold.maxPerSection} 处`,
    particle: `一个片段中 "${writing.particle.character}" 超过 ${writing.particle.maxPerPhrase} 个`,
    jargon: "使用黑话, 见禁用词",
    metaphor: "使用比喻用词, 见禁用词",
    translationese: "使用翻译腔句式, 见禁用词",
    pronoun: '句首使用没有名词的指代词, 例如 "它", "这是"',
    table: "表格源码的竖线没有按显示宽度对齐",
    length: `回复超过 ${writing.length.maxReplyLines} 行, 或记录文件超过 ${writing.length.maxFileLines} 行 (只追加的记录不限)`,
  };
  return renderTable(
    ["类别", "级别", "规则"],
    Object.entries(writing).map(([key, rule]) => [
      rule.label,
      SEVERITY_LABELS[rule.severity],
      descriptions[key] ?? "",
    ]),
  );
}

/**
 * 生成禁用词清单.
 *
 * @param {import("../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 各行.
 */
function writingWords(spec) {
  const { jargon, metaphor, translationese } = spec.writing;
  return [
    `- ${jargon.label}: ${jargon.words.join(", ")}.`,
    `- ${metaphor.label}: ${metaphor.words.join(", ")}.`,
    `- ${translationese.label}:`,
    ...translationese.patterns.map(({ advice }) => `  - ${advice}`),
  ];
}

await main();
