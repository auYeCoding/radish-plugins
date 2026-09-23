/**
 * @file Markdown 切分测试: 标题, 围栏与嵌套围栏.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMarkdown } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/markdown.mjs";

test("解析: 标题与普通文本", () => {
  const items = parseMarkdown("# 标题\n\n正文\n## 小节");
  assert.deepEqual(
    items.map((item) => item.kind),
    ["heading", "text", "text", "heading"],
  );
  assert.equal(items[3].kind === "heading" && items[3].level, 2);
});

test("解析: 围栏中的井号不是标题", () => {
  const items = parseMarkdown("```\n# 不是标题\n```");
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "block");
});

test("解析: 外层四个反引号可以包住三个反引号", () => {
  const items = parseMarkdown("````markdown\n```\n内层\n```\n````\n结尾");
  assert.equal(items[0].kind, "block");
  assert.equal(items[0].kind === "block" && items[0].language, "markdown");
  assert.equal(items[0].kind === "block" && items[0].content.length, 3);
  assert.equal(items[1].kind, "text");
});

test("解析: 波浪号围栏", () => {
  const items = parseMarkdown("~~~text\n内容\n~~~");
  assert.equal(items.length, 1);
  assert.equal(items[0].kind === "block" && items[0].language, "text");
});

test("解析: 未关闭的围栏", () => {
  const items = parseMarkdown("```\n内容");
  assert.equal(items[0].kind === "block" && items[0].isClosed, false);
});

test("解析: Windows 换行", () => {
  const items = parseMarkdown("# 标题\r\n正文\r\n");
  assert.equal(items[0].kind === "heading" && items[0].text, "标题");
});
