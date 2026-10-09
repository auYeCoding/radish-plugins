/**
 * @file discover-mcp.mjs 的行为测试: 子进程跑脚本, 用临时 HOME 放假的
 * ~/.claude.json 与项目 .mcp.json, 核对它从配置 (而非 PATH) 读出 MCP 服务, 合并
 * 全局与项目来源, 去重排序, 并给已知逆向工具附上用途说明.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

/**
 * 脚本入口的绝对路径.
 * @type {string}
 */
const SCRIPT = fileURLToPath(
  new URL(
    "../../plugins/tracepoint/runtime/tools/discover-mcp.mjs",
    import.meta.url,
  ),
);

/** @type {string} */
let home;
/** @type {string} */
let projectDir;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "tracepoint-home-"));
  projectDir = mkdtempSync(path.join(os.tmpdir(), "tracepoint-proj-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

/**
 * 以临时 HOME 跑脚本, 返回标准输出.
 *
 * @returns {string} 脚本标准输出.
 */
function runDiscover() {
  const result = spawnSync(process.execPath, [SCRIPT, projectDir], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("从全局与项目配置读出 MCP 并附用途, 不查 PATH", () => {
  writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { x64dbg: {}, "plugin_ida-pro-mcp_idalib": {} },
    }),
    "utf8",
  );
  writeFileSync(
    path.join(projectDir, ".mcp.json"),
    JSON.stringify({ mcpServers: { frida: {} } }),
    "utf8",
  );
  const out = runDiscover();
  assert.match(out, /共有 3 个/u);
  assert.match(out, /x64dbg/u);
  assert.match(out, /ida-pro-mcp/u);
  assert.match(out, /frida/u);
  assert.match(out, /IDA/u);
});

test("没有任何配置时提示没读到 MCP", () => {
  const out = runDiscover();
  assert.match(out, /没在全局.*读到 MCP|没读到 MCP/u);
});
