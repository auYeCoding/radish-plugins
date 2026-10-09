/**
 * @file 工具就位检查: 读全局与项目配置里配置了哪些 MCP 服务, 对照一份
 * 逆向工具清单, 提醒用户把还没连上的对应软件打开. 靠读配置而不是查 PATH, 所以装了
 * 但不在 PATH 中的工具 (通过 MCP 暴露的) 也能认出来.
 *
 * 用法: node <本文件> [项目目录]. 只读配置并打印报告, 不改任何东西, 也不联网.
 */

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 已知逆向相关 MCP 服务及其用途, 用于在报告里说明每个工具管什么 (工具清单).
 * 键按小写匹配配置里的服务名子串.
 * @type {Readonly<Record<string, string>>}
 */
const RE_TOOL_CATALOG = Object.freeze({
  ida: "IDA (含无界面 idalib): 静态反汇编与反编译, 交叉引用, 类型",
  ghidra: "Ghidra: 静态反汇编与反编译",
  x64dbg: "x64dbg: 64 位用户态动态调试",
  x32dbg: "x32dbg: 32 位用户态动态调试",
  dhs: "DHS: 反汇编集合体 (类似 IDA 与 x64dbg), 配 DHS 调试器, 驱动保护进程可调",
  jeb: "Jeb: Android 与多平台反编译",
  jadx: "jadx: Android dex 反编译",
  frida: "Frida: 动态插桩 (命令行, 多无 MCP)",
  cheatengine: "Cheat Engine: 内存扫描与调试",
  reqable: "Reqable: 网络抓包 (网络协议目标不在本插件范围)",
  radare2: "radare2 / r2: 反汇编与调试",
  binaryninja: "Binary Ninja: 反汇编与反编译",
});

/**
 * 入口: 扫描配置, 打印工具就位报告.
 *
 * @returns {void}
 */
function main() {
  const projectDir = process.argv[2] ?? process.cwd();
  const configured = collectConfiguredServers(projectDir);
  const lines = ["[tracepoint] 工具就位检查 (读配置, 不查 PATH):"];
  if (configured.length === 0) {
    lines.push(
      "- 没在全局 ~/.claude.json 或项目配置里读到 MCP 服务. 若逆向工具靠 MCP 接入, 确认它们已在配置中.",
    );
  } else {
    lines.push(`- 配置里共有 ${configured.length} 个 MCP 服务:`);
    for (const name of configured) {
      const note = catalogNote(name);
      lines.push(`  - ${name}${note === undefined ? "" : ` -- ${note}`}`);
    }
    lines.push(
      "- 这些服务要对应软件打开才连得上; 连不上的多半是软件没开, 不是故障. 开工前提醒用户打开需要的那几个, 别因为没就位就退回去硬啃磁盘字节.",
    );
    lines.push(
      "- 功能有重叠 (IDA 静态, x64dbg 动态, DHS 兼有) 时, 按目标与阶段选, 不要不管合不合适都上同一个.",
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * 从全局与项目配置收集配置过的 MCP 服务名, 去重排序.
 *
 * @param {string} projectDir 项目目录.
 * @returns {string[]} 服务名列表.
 */
function collectConfiguredServers(projectDir) {
  const names = new Set();
  const globalConfig = readJson(path.join(os.homedir(), ".claude.json"));
  for (const name of serverNames(globalConfig?.mcpServers)) {
    names.add(name);
  }
  const resolvedProject = path.resolve(projectDir);
  const projectEntry = globalConfig?.projects?.[resolvedProject];
  for (const name of serverNames(projectEntry?.mcpServers)) {
    names.add(name);
  }
  const projectMcp = readJson(path.join(resolvedProject, ".mcp.json"));
  for (const name of serverNames(projectMcp?.mcpServers)) {
    names.add(name);
  }
  return [...names].sort((first, second) => first.localeCompare(second));
}

/**
 * 取一个 mcpServers 对象的键.
 *
 * @param {unknown} servers mcpServers 对象.
 * @returns {string[]} 键列表.
 */
function serverNames(servers) {
  return isPlainObject(servers) ? Object.keys(servers) : [];
}

/**
 * 查一个服务名在工具清单里的用途说明.
 *
 * @param {string} name 服务名.
 * @returns {string | undefined} 用途; 不认识时为 undefined.
 */
function catalogNote(name) {
  const lower = name.toLowerCase();
  const key = Object.keys(RE_TOOL_CATALOG).find((entry) =>
    lower.includes(entry),
  );
  return key === undefined ? undefined : RE_TOOL_CATALOG[key];
}

/**
 * 读 JSON 文件; 不存在或损坏时返回 undefined.
 *
 * @param {string} file 文件路径.
 * @returns {Record<string, any> | undefined} 解析结果.
 */
function readJson(file) {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return isPlainObject(parsed) ? parsed : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * 判断是否为普通对象.
 *
 * @param {unknown} value 任意值.
 * @returns {boolean} 是普通对象时返回 true.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
