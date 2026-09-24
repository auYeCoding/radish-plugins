/**
 * @file 源码证据测试: 表格解析, 证据表的读取与写法校验, 从本机临时仓库按版本取行,
 * 核对输出与单条自查命令. 不访问网络.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  PLACEHOLDER,
  renderFileSkeleton,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/render.mjs";
import {
  EVIDENCE_COLUMNS,
  MAX_EVIDENCE_LINES,
  evidenceProblem,
  formatEvidence,
  parseLineRange,
  readEvidenceRows,
  verifyEvidenceRows,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/source-evidence.mjs";
import {
  fetchVersion,
  readSourceLines,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/source-fetch.mjs";
import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { parseTable } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/table.mjs";
import { WorkflowError } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/workflow-error.mjs";
import {
  PLUGIN_COMMAND,
  commitPaths,
  createTemporaryDirectory,
  createTemporaryRepository,
  runCommand,
  runGit,
} from "./helpers.mjs";

/**
 * 写法合格的一条证据.
 * @type {Readonly<import("../../plugins/waypoint/skills/project-navigator/runtime/lib/source-evidence.mjs").EvidenceRow>}
 */
const VALID_ROW = Object.freeze({
  capability: "H2 支持",
  repository: "https://github.com/encode/httpx",
  version: "0.28.1",
  path: "httpx/_client.py",
  lines: "650-651",
  note: "Client 接受 http2 参数",
});

/**
 * 测试用的完整提交号.
 * @type {string}
 */
const SAMPLE_COMMIT = "a".repeat(40);

test("表格: 解析表头与各行, 还原转义的竖线, 缺少分隔行时不算表格", () => {
  assert.deepEqual(
    parseTable([
      "说明文字",
      "| 甲 | 乙 |",
      "| --- | :---: |",
      "| a\\|b | c |",
      "",
      "| x | y |",
    ]),
    { headers: ["甲", "乙"], rows: [["a|b", "c"]] },
  );
  assert.equal(parseTable(["| 甲 | 乙 |", "| a | b |"]), undefined);
  assert.equal(parseTable(["没有表格"]), undefined);
});

test("证据: 从回执中读出证据表, 没有证据表时报错", () => {
  const spec = loadSpec();
  const skeleton = renderFileSkeleton({
    fileSpec: spec.files.receipt,
    variantIndex: 1,
    state: undefined,
    spec,
  });
  const row = `| ${Object.keys(EVIDENCE_COLUMNS)
    .map((key) => VALID_ROW[key])
    .join(" | ")} |`;
  const text = skeleton.replace(
    new RegExp(`^\\| ${PLACEHOLDER}.*$`, "mu"),
    row,
  );
  assert.deepEqual(readEvidenceRows(text), [VALID_ROW]);
  const formatted = text.replace(
    row,
    "| H2 支持 | `https://github.com/encode/httpx` | `0.28.1` | httpx/\\_client.py | 650-651 | Client 接受 http2 参数 |",
  );
  assert.deepEqual(
    readEvidenceRows(formatted),
    [VALID_ROW],
    "行内代码与 Markdown 转义都还原成原文",
  );
  assert.throws(
    () => readEvidenceRows("# 工单回执\n\n## 能力核实\n\n只有文字.\n"),
    WorkflowError,
  );
});

test("证据: 仓库, 版本, 路径与行号的写法校验", () => {
  assert.equal(evidenceProblem(VALID_ROW), undefined);
  const invalidChanges = [
    { repository: "D:/repos/httpx" },
    { repository: "http://github.com/encode/httpx" },
    { repository: "file:///tmp/httpx" },
    { version: "-upload-pack=x" },
    { version: "" },
    { path: "/etc/passwd" },
    { path: "src\\h2\\connection.py" },
    { path: "../outside.py" },
    { path: "--help" },
    { lines: "0" },
    { lines: "10-5" },
    { lines: `1-${MAX_EVIDENCE_LINES + 1}` },
    { lines: "第 3 行" },
  ];
  for (const change of invalidChanges) {
    assert.ok(
      evidenceProblem({ ...VALID_ROW, ...change }) !== undefined,
      JSON.stringify(change),
    );
  }
  assert.deepEqual(parseLineRange("7"), { start: 7, end: 7 });
  assert.deepEqual(parseLineRange(`1-${MAX_EVIDENCE_LINES}`), {
    start: 1,
    end: MAX_EVIDENCE_LINES,
  });
  assert.match(
    verifyEvidenceRows(
      [{ ...VALID_ROW, repository: "D:/repos/httpx" }],
      "unused",
    )[0].problem ?? "",
    /仓库应写 https/u,
    "写法不合格的证据不访问任何仓库",
  );
});

test("证据: 从仓库按版本取回被引用的行, 版本, 路径或行号不对时给出原因", () => {
  const source = createTemporaryRepository();
  const cache = createTemporaryDirectory();
  try {
    mkdirSync(path.join(source.root, "src", "pkg"), { recursive: true });
    writeFileSync(
      path.join(source.root, "src", "pkg", "core.py"),
      "first\nsecond\nthird\n",
      "utf8",
    );
    const head = commitPaths(source.root, ["src"], "add core");
    runGit(source.root, ["tag", "v1.0.0"]);
    const location = {
      cacheRoot: path.join(cache.root, "evidence"),
      repository: source.root,
    };
    const version = fetchVersion({ ...location, version: "v1.0.0" });
    assert.equal(version.commit, head);
    assert.deepEqual(
      fetchVersion({ ...location, version: head }),
      version,
      "已有缓存时按完整提交号再次获取, 结果相同",
    );
    assert.match(
      fetchVersion({ ...location, version: "1.0.0" }).problem ?? "",
      /取不到版本 1\.0\.0/u,
    );
    const read = {
      ...location,
      commit: head,
      filePath: "src/pkg/core.py",
      range: { start: 2, end: 3 },
    };
    assert.deepEqual(readSourceLines(read).excerpt, {
      commit: head,
      lines: [
        { number: 2, text: "second" },
        { number: 3, text: "third" },
      ],
    });
    assert.match(
      readSourceLines({ ...read, filePath: "pkg/core.py" }).problem ?? "",
      /取不到文件 pkg\/core\.py/u,
    );
    assert.match(
      readSourceLines({ ...read, range: { start: 3, end: 4 } }).problem ?? "",
      /只有 3 行/u,
    );
  } finally {
    source.cleanup();
    cache.cleanup();
  }
});

test("证据: 核对输出列出提交与源码, 取不到时写明原因", () => {
  const lines = formatEvidence({
    index: 1,
    row: VALID_ROW,
    excerpt: {
      commit: SAMPLE_COMMIT,
      lines: [
        { number: 9, text: "first" },
        { number: 10, text: "second" },
      ],
    },
  });
  assert.equal(lines[0], "证据 1: H2 支持");
  assert.ok(lines.includes(`- 提交: ${SAMPLE_COMMIT}`));
  assert.ok(lines.includes("     9 | first"));
  assert.ok(lines.includes("    10 | second"));
  const failed = formatEvidence({
    index: 2,
    row: VALID_ROW,
    problem: "网络不通.",
  });
  assert.equal(failed.at(-1), "- 结果: 取不到源码. 网络不通.");
});

test("证据: 单条自查命令报告写法问题, 不访问网络; 参数不全时以退出码 1 结束", () => {
  const repository = createTemporaryRepository();
  try {
    const result = runCommand(
      PLUGIN_COMMAND,
      [
        "evidence",
        "check",
        "D:/repos/httpx",
        "0.28.1",
        "httpx/_client.py",
        "650",
      ],
      repository.root,
    );
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /仓库应写 https/u);
    assert.match(result.stdout, /取不到 1 条/u);
    assert.equal(
      runCommand(PLUGIN_COMMAND, ["evidence", "check", "x"], repository.root)
        .status,
      1,
    );
  } finally {
    repository.cleanup();
  }
});
