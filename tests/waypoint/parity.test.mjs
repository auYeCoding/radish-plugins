/**
 * @file 守卫 tracepoint 与 waypoint 两份 self-iteration.mjs 副本完全一致.
 * 插件独立安装时不能引用其它插件的文件, 所以这份纯逻辑在两个插件里各内置一份;
 * 这个测试逐字节比对两个文件, 把 "改一份要同步另一份" 从人工约定变成守卫.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * 读取相对本测试文件的源码全文.
 *
 * @param {string} relativePath 相对本测试文件的路径.
 * @returns {string} 文件全文.
 */
function readSource(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

test("两份 self-iteration 副本完全一致", () => {
  const tracepoint = readSource(
    "../../plugins/tracepoint/runtime/lib/self-iteration.mjs",
  );
  const waypoint = readSource(
    "../../plugins/waypoint/runtime/lib/self-iteration.mjs",
  );
  assert.equal(
    waypoint,
    tracepoint,
    "两份 self-iteration.mjs 必须完全一致; 改了一份要同步另一份 (见 MAINTAINING 速查表).",
  );
});
