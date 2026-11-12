/**
 * @file decision 命令: 登记一条决策, 并把条目追加到决策记录.
 *
 * 用法: decision add --from <草稿>.
 */

import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DECISIONS_HEADER, addDecision } from "../lib/decisions.mjs";
import { DECISIONS_FILE } from "../lib/paths.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { openProject, readDraftJson, saveState } from "./support.mjs";

/**
 * decision 命令唯一的子命令.
 * @type {string}
 */
const ADD_SUBCOMMAND = "add";

/**
 * 草稿的格式说明.
 * @type {string}
 */
const DRAFT_FORMAT =
  '{"title": "一句话标题", "decision": "决定了什么", "reason": "为什么", "rejected": "放弃了什么", "supersedes": "被取代的决策编号, 没有时不写"}';

/**
 * 执行 decision 命令.
 *
 * @param {import("./handlers.mjs").CommandInvocation} invocation 命令调用.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 子命令未知或草稿不合法时.
 */
export function runDecision({ positionals, values, cwd, now }) {
  if (positionals[0] !== ADD_SUBCOMMAND) {
    throw new WorkflowError(
      `decision 的用法: decision add --from <草稿>, 草稿格式: ${DRAFT_FORMAT}.`,
    );
  }
  const { projectRoot, state } = openProject(cwd);
  const { state: next, entry } = addDecision(
    state,
    readDraftJson(projectRoot, values.from),
    now,
  );
  const file = path.join(projectRoot, DECISIONS_FILE);
  if (!existsSync(file)) {
    writeFileSync(file, DECISIONS_HEADER, "utf8");
  }
  appendFileSync(file, `\n${entry}`, "utf8");
  saveState(projectRoot, next, now);
  return [`- 执行结果: ${next.lastAction}, 条目已追加到 ${DECISIONS_FILE}`];
}
