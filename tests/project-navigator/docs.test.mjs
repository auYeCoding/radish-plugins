/**
 * @file 文档检查: 生成文档与规格同步, SKILL.md 不超过篇幅上限.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadSpec } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/spec.mjs";
import { SKILL_DIRECTORY } from "./helpers.mjs";

/**
 * 仓库根目录.
 * @type {string}
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * SKILL.md 的 token 上限 (官方建议技能主文件保持在 5000 token 以内).
 * @type {number}
 */
const SKILL_TOKEN_LIMIT = 5000;

/**
 * 估算 token 时, 非汉字字符每多少个约合一个 token.
 * @type {number}
 */
const CHARACTERS_PER_TOKEN = 4;

/**
 * 粗略估算文本的 token 数: 每个汉字按 1 个计算, 其余字符每 4 个按 1 个计算.
 * 这是偏保守的近似, 只用于防止 SKILL.md 失控增长.
 *
 * @param {string} text 文本.
 * @returns {number} 估算的 token 数.
 */
function estimateTokens(text) {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  return han + Math.ceil(([...text].length - han) / CHARACTERS_PER_TOKEN);
}

test("文档: 生成的参考文档与执行手册和规格同步", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "gen-navigator-docs.mjs"), "--check"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("文档: SKILL.md 写明的人类总结字数上限与规格一致", () => {
  const text = readFileSync(path.join(SKILL_DIRECTORY, "SKILL.md"), "utf8");
  assert.ok(
    text.includes(
      `人类总结的正文不超过 ${loadSpec().format.summaryMaxLength} 字`,
    ),
  );
});

test("文档: SKILL.md 不超过篇幅上限", () => {
  const text = readFileSync(path.join(SKILL_DIRECTORY, "SKILL.md"), "utf8");
  const tokens = estimateTokens(text);
  assert.ok(
    tokens <= SKILL_TOKEN_LIMIT,
    `SKILL.md 约 ${tokens} token, 超过 ${SKILL_TOKEN_LIMIT}`,
  );
});
