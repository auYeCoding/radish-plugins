/**
 * @file 记录文件结构校验测试: 每种文件的骨架填写后合格, 填写要求覆盖每个受校验的节,
 * 常见违规被指出.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkFile,
  findFileSpec,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/file-checks.mjs";
import {
  KEY_SECTION_RULE,
  renderFileGuide,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/file-guide.mjs";
import {
  PLACEHOLDER,
  renderFileSkeleton,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import { renderGlossarySeed } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render-plan.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { renderTable } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/table.mjs";

/**
 * 模板规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TemplateSpec}
 */
const SPEC = loadSpec();

/**
 * 填写骨架中占位符时使用的文字.
 * @type {string}
 */
const FILLER = "已填写的内容";

/**
 * 生成某种文件的合格样例: 表格中只能取固定值的列填第一个允许的值, 其余占位符填普通文字.
 *
 * @param {string} kind 文件种类.
 * @param {number} [variantIndex] 结构编号, 从 0 开始.
 * @returns {string} 合格的文件全文.
 */
function filledFile(kind, variantIndex = 0) {
  const fileSpec = SPEC.files[kind];
  const sections = (fileSpec.variants ?? [fileSpec.sections ?? []])[
    variantIndex
  ];
  const skeleton = renderFileSkeleton({
    fileSpec,
    variantIndex,
    state: undefined,
    spec: SPEC,
  });
  return sections
    .filter((section) => section.table !== undefined)
    .reduce(
      (text, section) =>
        text.replace(placeholderRow(section.table), sampleRow(section.table)),
      skeleton,
    )
    .split(PLACEHOLDER)
    .join(FILLER);
}

/**
 * 骨架中表格的占位行.
 *
 * @param {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TableSpec} table 表格规格.
 * @returns {string} 占位行.
 */
function placeholderRow(table) {
  return renderTable(table.columns, [table.columns.map(() => PLACEHOLDER)])[2];
}

/**
 * 填好的表格行: 只能取固定值的列填第一个允许的值, 其余列填普通文字.
 *
 * @param {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs").TableSpec} table 表格规格.
 * @returns {string} 表格行.
 */
function sampleRow(table) {
  const cells = table.columns.map(
    (column) => table.choices?.[column]?.[0] ?? FILLER,
  );
  return `| ${cells.join(" | ")} |`;
}

/**
 * 校验某种文件.
 *
 * @param {string} kind 文件种类.
 * @param {string} text 文件全文.
 * @returns {string[]} 问题列表.
 */
function check(kind, text) {
  return checkFile({ text, fileSpec: SPEC.files[kind], spec: SPEC });
}

for (const [kind, fileSpec] of Object.entries(SPEC.files)) {
  (fileSpec.variants ?? [fileSpec.sections]).forEach((_variant, index) => {
    test(`文件: ${kind} 第 ${index + 1} 种结构的填写样例合格`, () => {
      assert.deepEqual(check(kind, filledFile(kind, index)), []);
    });
  });
}

for (const [kind, fileSpec] of Object.entries(SPEC.files)) {
  (fileSpec.variants ?? [fileSpec.sections ?? []]).forEach(
    (sections, index) => {
      test(`文件: ${kind} 第 ${index + 1} 种结构的填写要求列出每个键值节与表格节`, () => {
        const guide = renderFileGuide({ fileSpec, sections }).join("\n");
        assert.match(guide, /^填写要求:\n/u);
        assert.match(guide, /\n骨架:\n$/u);
        for (const section of sections) {
          if (section.keys !== undefined || section.table !== undefined) {
            assert.ok(guide.includes(`"${section.title}"`), section.title);
          }
        }
      });
    },
  );
}

test("文件: 回执的填写要求写明键值节每个键只占一行, 多行内容放没有键名的节", () => {
  const guide = renderFileGuide({
    fileSpec: SPEC.files.receipt,
    sections: SPEC.files.receipt.variants[0],
  }).join("\n");
  assert.ok(guide.includes(KEY_SECTION_RULE));
  assert.match(guide, /"测试记录"/u);
  assert.match(guide, /表格与多行内容写进没有键名的节 \("前提核对"/u);
  assert.match(guide, /project-navigator check <文件路径>/u);
});

test("文件: 键值节中接了表格时自查报告问题, 理由与填写要求一致", () => {
  const text = filledFile("receipt").replace(
    `- 测试结果: ${FILLER}\n`,
    `- 测试结果: 见下表\n\n| 命令 | 退出码 |\n| --- | --- |\n| npm test | 0 |\n`,
  );
  assert.ok(
    check("receipt", text).some((problem) =>
      problem.includes('"## 测试记录" 应依次包含'),
    ),
  );
});

test("文件: init 写入的术语表结构合格", () => {
  assert.deepEqual(check("glossary", renderGlossarySeed(SPEC)), []);
});

test("文件: 路径匹配到对应的规格", () => {
  assert.equal(
    findFileSpec(SPEC, ".navigator/orders/0007-export-csv/order.md"),
    SPEC.files.order,
  );
  assert.equal(
    findFileSpec(SPEC, ".navigator/orders/0007-export-csv/receipt.md"),
    SPEC.files.receipt,
  );
  assert.equal(findFileSpec(SPEC, ".navigator/plan/notes.md"), undefined);
});

test("文件: 一级标题错误", () => {
  const text = filledFile("order").replace("# 执行工单", "# 工单");
  assert.match(check("order", text)[0], /一级标题/u);
});

test("文件: 缺少固定节", () => {
  const text = filledFile("order").replace(
    "## 执行守则\n\n已填写的内容\n\n",
    "",
  );
  assert.ok(
    check("order", text).some((problem) => problem.includes("二级标题")),
  );
});

test("文件: 键值行缺少一个键", () => {
  const text = filledFile("review").replace(/- 验收轮次: .+\n/u, "");
  assert.ok(
    check("review", text).some((problem) => problem.includes("验收轮次")),
  );
});

test("文件: 选型回执使用第二种结构", () => {
  assert.deepEqual(check("receipt", filledFile("receipt", 1)), []);
});

test("文件: 判据核对的结论只能取规格中的值", () => {
  const text = filledFile("review").replace("| 通过 |", "| 部分验证 |");
  const problems = check("review", text);
  assert.ok(
    problems.some(
      (problem) => problem.includes("部分验证") && problem.includes("只能是"),
    ),
    problems.join("\n"),
  );
});

test("文件: 表格中有空单元格", () => {
  const text = filledFile("review").replace(
    `| ${FILLER} | 通过 | ${FILLER} |`,
    `| ${FILLER} | 通过 |  |`,
  );
  assert.ok(
    check("review", text).some((problem) => problem.includes("每格都要填写")),
  );
});

test("文件: 选型回执缺少证据表时指出表格问题, 不误报为结构 1 的标题问题", () => {
  const text = filledFile("receipt", 1).replace(
    /## 能力核实\n\n(?:\|.*\n)+/u,
    "## 能力核实\n\n只写了一段文字.\n",
  );
  const problems = check("receipt", text);
  assert.ok(
    problems.some((problem) => problem.includes("表头依次为")),
    problems.join("\n"),
  );
  assert.ok(!problems.some((problem) => problem.includes("二级标题应依次为")));
});

test("文件: 节中贴代码", () => {
  const text = filledFile("brief").replace(
    "## 成品样子\n\n已填写的内容",
    "## 成品样子\n\n```js\nconsole.log(1)\n```",
  );
  assert.ok(check("brief", text).some((problem) => problem.includes("代码块")));
});

test("文件: 残留占位符", () => {
  const skeleton = renderFileSkeleton({
    fileSpec: SPEC.files.glossary,
    state: undefined,
    spec: SPEC,
  });
  assert.ok(
    check("glossary", skeleton).some((problem) =>
      problem.includes(PLACEHOLDER),
    ),
  );
});

test("文件: 只追加记录的条目标题必须符合格式", () => {
  const base = filledFile("decisions");
  const entry = (title) =>
    `${base}\n## ${title}\n\n${SPEC.files.decisions.entryKeys.map((key) => `- ${key}: 内容`).join("\n")}\n`;
  assert.deepEqual(check("decisions", entry("决策 0001: 选用 PostgreSQL")), []);
  assert.ok(
    check("decisions", entry("选用 PostgreSQL")).some((problem) =>
      problem.includes("多出了"),
    ),
  );
});

test("文件: 头脑风暴的收尾节只能在条目之后", () => {
  const base = filledFile("brainstorm");
  const closing =
    "## 收敛结果\n\n- 必须要做: 甲\n- 明确不做: 乙\n- 优先验证: 丙\n";
  const withRound = `${base}\n## 轮次 0001: 问题与动机\n\n内容\n\n${closing}`;
  assert.deepEqual(check("brainstorm", withRound), []);
  const roundAfterClosing = `${base}\n${closing}\n## 轮次 0002: 使用人群\n\n内容\n`;
  assert.ok(check("brainstorm", roundAfterClosing).length > 0);
});

test("文件: 标题下方可以有一行结论, 其它内容不行", () => {
  const withConclusion = filledFile("brief").replace(
    "# 项目简报\n",
    "# 项目简报\n\n结论: 简报第 1 版.\n",
  );
  assert.deepEqual(check("brief", withConclusion), []);
  const withParagraph = filledFile("brief").replace(
    "# 项目简报\n",
    "# 项目简报\n\n一段说明.\n",
  );
  assert.ok(check("brief", withParagraph).length > 0);
});

test("文件: 结尾的代码块算作贴代码", () => {
  const text = `${filledFile("brief")}\n\`\`\`text\n总结\n\`\`\`\n`;
  assert.ok(check("brief", text).some((problem) => problem.includes("代码块")));
});
