/**
 * @file risk, decision, change 命令: 登记风险, 决策与变更, 更新它们的状态.
 *
 * 用法 (中文内容一律通过草稿传入):
 * - risk add --from <草稿>, 草稿 {"description", "severity", "source", "handling"}
 * - risk set <编号> <open | investigating | resolved | accepted> [--from <草稿>], 草稿 {"handling"}
 * - decision add --from <草稿>, 草稿 {"title"}
 * - decision supersede <编号> --by <编号>
 * - change add --from <草稿>, 草稿 {"title", "status"}
 */

import { WorkflowError } from "../lib/workflow-error.mjs";
import {
  addChange,
  addDecision,
  addRisk,
  setRiskStatus,
  supersedeDecision,
} from "../lib/workflow-records.mjs";
import {
  openProject,
  readDraftJson,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * 执行记录相关命令.
 *
 * @param {object} options 命令参数.
 * @param {"risk" | "decision" | "change"} options.command 命令名.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {Record<string, any>} options.values 选项值.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法时.
 */
export function runRecords({ command, positionals, values, cwd, now }) {
  const context = openProject(cwd);
  const [action, id, status] = positionals;
  const next = applyAction({ command, action, id, status, values, context });
  const saved = saveState(context, next, now);
  return [...resultLines(saved), ...newIdLine(command, action, saved)];
}

/**
 * 按命令与动作计算新状态.
 *
 * @param {object} options 动作参数.
 * @param {string} options.command 命令名.
 * @param {string | undefined} options.action 动作名.
 * @param {string | undefined} options.id 条目编号.
 * @param {string | undefined} options.status 新状态.
 * @param {Record<string, any>} options.values 选项值.
 * @param {import("./support.mjs").ProjectContext} options.context 项目上下文.
 * @returns {import("../lib/state.mjs").NavigatorState} 新状态.
 * @throws {WorkflowError} 命令或动作不合法时.
 */
function applyAction({ command, action, id, status, values, context }) {
  const { state, projectRoot } = context;
  const key = `${command} ${action ?? ""}`;
  switch (key) {
    case "risk add":
      return addRisk(state, readDraftJson(projectRoot, values.from));
    case "risk set": {
      const handling =
        values.from === undefined
          ? undefined
          : readDraftJson(projectRoot, values.from).handling;
      return setRiskStatus(
        state,
        requireId(id),
        String(status ?? ""),
        handling,
      );
    }
    case "decision add":
      return addDecision(
        state,
        String(readDraftJson(projectRoot, values.from).title ?? ""),
      );
    case "decision supersede":
      return supersedeDecision(state, requireId(id), String(values.by ?? ""));
    case "change add": {
      const draft = readDraftJson(projectRoot, values.from);
      return addChange(
        state,
        String(draft.title ?? ""),
        String(draft.status ?? ""),
      );
    }
    default:
      throw new WorkflowError(
        "用法: risk add | risk set <编号> <状态> | decision add | decision supersede <编号> --by <编号> | change add.",
      );
  }
}

/**
 * 新增条目时输出新编号, 方便编排会话在记录文件中使用.
 *
 * @param {string} command 命令名.
 * @param {string | undefined} action 动作名.
 * @param {import("../lib/state.mjs").NavigatorState} state 写入后的状态.
 * @returns {string[]} 输出各行.
 */
function newIdLine(command, action, state) {
  if (action !== "add") {
    return [];
  }
  const list = {
    risk: state.risks,
    decision: state.decisions,
    change: state.changes,
  }[command];
  const created = list?.[list.length - 1];
  return created === undefined ? [] : [`- 新增编号: ${created.id}`];
}

/**
 * 确认提供了条目编号.
 *
 * @param {string | undefined} id 编号.
 * @returns {string} 编号.
 * @throws {WorkflowError} 缺少编号时.
 */
function requireId(id) {
  if (id === undefined) {
    throw new WorkflowError("缺少条目编号.");
  }
  return id;
}
