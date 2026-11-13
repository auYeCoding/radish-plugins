/**
 * @file 切片文件测试: 骨架, 解析, 计划摘要, 未填写的小节, 标准核对表, 补做时的归档.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

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
  prepareRework,
  readCriteria,
  readResultStatus,
  readVerdicts,
  renderSliceFile,
  sectionsFor,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/slice-file.mjs";

/**
 * 切片文件规格.
 * @type {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/slice-file.mjs").SliceSpec}
 */
const SPEC = loadSliceSpec();

/**
 * 填写占位时使用的文字.
 * @type {string}
 */
const FILLER = "已填写";

/**
 * 生成某种切片的骨架.
 *
 * @param {string} kind 切片种类.
 * @returns {string} 文件全文.
 */
function skeleton(kind) {
  return renderSliceFile({
    spec: SPEC,
    slice: { id: "0003", name: "导出 CSV", kind },
    summary: "里程 0001 能导出",
  });
}

/**
 * 把骨架中的占位都换成普通文字.
 *
 * @param {string} text 文件全文.
 * @returns {string} 填写后的全文.
 */
function fillAll(text) {
  return text.replace(/\(待填写[^)]*\)/gu, FILLER);
}

test("切片文件: 规格中的小节编号不重复, 脚本引用的编号都在规格中", () => {
  const ids = SPEC.parts.flatMap((part) =>
    part.sections.map((section) => section.id),
  );
  assert.equal(new Set(ids).size, ids.length);
  for (const id of Object.values(SECTIONS)) {
    assert.ok(ids.includes(id), id);
  }
  assert.deepEqual(
    SPEC.parts.map((part) => part.id),
    Object.values(PARTS),
  );
});

test("切片文件: 骨架按种类取舍小节, 三段都能解析出来", () => {
  for (const kind of ["build", "findings"]) {
    const parsed = parseSliceFile(skeleton(kind), SPEC);
    for (const part of SPEC.parts) {
      assert.deepEqual(
        Object.keys(parsed.parts[part.id].sections),
        sectionsFor(part, kind).map((section) => section.title),
        `${kind} ${part.id}`,
      );
    }
  }
  assert.match(skeleton("build"), /^# 切片 0003: 导出 CSV\n\n里程 0001/u);
  assert.match(skeleton("build"), /### 模块安排/u);
  assert.doesNotMatch(skeleton("findings"), /### 模块安排|### 接线证据/u);
});

test("切片文件: 没有填写的小节被指出, 初始写了 无 的小节算已填写", () => {
  const blank = parseSliceFile(skeleton("build"), SPEC);
  const unfilled = findUnfilledSections({
    parsed: blank,
    spec: SPEC,
    partId: PARTS.plan,
    kind: "build",
  });
  assert.ok(unfilled.includes("目标"));
  assert.ok(unfilled.includes("模块安排"));
  assert.ok(!unfilled.includes("补做"));
  const filled = parseSliceFile(fillAll(skeleton("build")), SPEC);
  for (const part of SPEC.parts) {
    assert.deepEqual(
      findUnfilledSections({
        parsed: filled,
        spec: SPEC,
        partId: part.id,
        kind: "build",
      }),
      [],
    );
  }
  assert.deepEqual(
    findUnfilledSections({
      parsed: parseSliceFile("# 切片\n\n## 计划\n", SPEC),
      spec: SPEC,
      partId: PARTS.result,
      kind: "build",
    }),
    ["执行结果"],
  );
});

test("切片文件: 计划摘要不受表格重排与空行影响, 内容改动时变化", () => {
  const text = fillAll(skeleton("build"));
  const digest = digestPlan(parseSliceFile(text, SPEC));
  const reformatted = text
    .replace(/\| -+ /gu, "| ------------ ")
    .replace("### 目标\n", "### 目标\n\n\n")
    .replaceAll("\n", "\r\n");
  assert.equal(digestPlan(parseSliceFile(reformatted, SPEC)), digest);
  const resultChanged = text.replace(
    "## 执行结果\n",
    "## 执行结果\n\n多写的\n",
  );
  assert.equal(digestPlan(parseSliceFile(resultChanged, SPEC)), digest);
  const planChanged = text.replace("### 目标\n", "### 目标\n\n改了\n");
  assert.notEqual(digestPlan(parseSliceFile(planChanged, SPEC)), digest);
  assert.equal(digestPlan(parseSliceFile("# 空\n", SPEC)), undefined);
});

test("切片文件: 读出完成标准, 需要决定与执行状态", () => {
  const text = fillAll(skeleton("build"))
    .replace(
      `### 完成标准\n\n${FILLER}`,
      "### 完成标准\n\n1. 第一条.\n2. 第二条.",
    )
    .replace(`### 需要决定\n\n${FILLER}`, "### 需要决定\n\n- 无.")
    .replace(`### 执行状态\n\n${FILLER}`, "### 执行状态\n\n完成.");
  const parsed = parseSliceFile(text, SPEC);
  assert.deepEqual(readCriteria(parsed, SPEC), ["第一条.", "第二条."]);
  assert.equal(isPlanSectionNone(parsed, SPEC, SECTIONS.decisions), true);
  assert.equal(isPlanSectionNone(parsed, SPEC, SECTIONS.criteria), false);
  assert.equal(readResultStatus(parsed, SPEC), SPEC.doneStatus);
  assert.equal(
    readResultStatus(parseSliceFile(skeleton("build"), SPEC), SPEC),
    "",
  );
  assert.equal(readResultStatus(undefined, SPEC), "");
});

test("切片文件: 标准核对表的结论只能取规格中的几种, 每行要有证据, 并按最差的归类", () => {
  const withRows = (rows) =>
    parseSliceFile(
      skeleton("build").replace(
        /(### 标准核对\n\n\|[^\n]+\n\|[^\n]+\n)\|[^\n]+\n/u,
        `$1${rows.join("\n")}\n`,
      ),
      SPEC,
    );
  assert.deepEqual(
    readVerdicts(parseSliceFile(skeleton("build"), SPEC), SPEC),
    {
      rows: [],
      problems: [],
    },
  );
  const mixed = readVerdicts(
    withRows(["| 1 | 通过 | a.js:1 |", "| 2 | 未验证 | 待定: 缺设备 |"]),
    SPEC,
  );
  assert.deepEqual(mixed.problems, []);
  assert.equal(classifyVerdicts(mixed.rows, SPEC), VERDICT_CLASSES.unverified);
  const failed = readVerdicts(
    withRows(["| 1 | 不通过 | a.js:1 |", "| 2 | 未验证 | b |"]),
    SPEC,
  );
  assert.equal(classifyVerdicts(failed.rows, SPEC), VERDICT_CLASSES.fail);
  assert.equal(
    classifyVerdicts(
      readVerdicts(withRows(["| 1 | 通过 | a.js:1 |"]), SPEC).rows,
      SPEC,
    ),
    VERDICT_CLASSES.pass,
  );
  const confirmed = readVerdicts(
    withRows([
      "| 1 | 通过 | a.js:1 |",
      `| 2 | ${SPEC.verdicts.confirmed} | 用户 2026-11-13: 看到了 |`,
    ]),
    SPEC,
  );
  assert.deepEqual(confirmed.problems, []);
  assert.equal(classifyVerdicts(confirmed.rows, SPEC), VERDICT_CLASSES.pass);
  const invalid = readVerdicts(
    withRows(["| 1 | 部分通过 | a |", "| 2 | 通过 |  |"]),
    SPEC,
  );
  assert.equal(invalid.problems.length, 2);
  assert.match(invalid.problems[0], /部分通过.*只能是/u);
  assert.match(invalid.problems[1], /没有证据/u);
});

test("切片文件: 补做时归档旧的验收段, 执行状态改为补做中, 计划段不动", () => {
  const text = fillAll(skeleton("build")).replace(
    `### 执行状态\n\n${FILLER}`,
    "### 执行状态\n\n完成",
  );
  const reworked = prepareRework({
    text,
    spec: SPEC,
    kind: "build",
    round: 1,
  });
  assert.match(reworked, /^## 验收 \(第 1 轮\)$/mu);
  assert.equal(reworked.match(/^## 验收$/gmu)?.length, 1);
  const parsed = parseSliceFile(reworked, SPEC);
  assert.equal(readResultStatus(parsed, SPEC), SPEC.reworkStatus);
  assert.deepEqual(readVerdicts(parsed, SPEC).rows, []);
  assert.equal(digestPlan(parsed), digestPlan(parseSliceFile(text, SPEC)));
  const again = prepareRework({
    text: reworked,
    spec: SPEC,
    kind: "build",
    round: 2,
  });
  assert.match(again, /^## 验收 \(第 2 轮\)$/mu);
  assert.equal(again.match(/^## 验收$/gmu)?.length, 1);
});
