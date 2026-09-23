/**
 * @file snapshots, restore, adopt 命令: 处理对账发现的异常.
 *
 * 用法:
 * - snapshots: 列出最近的快照
 * - restore <提交>: 把状态目录恢复为某个快照或某个普通提交中的内容
 * - adopt: 把当前 HEAD 与状态目录的当前内容纳入记录
 *
 * restore 与 adopt 都只在用户于 "验收异常" 中作出选择后执行.
 */

import { headCommit, shortHash } from "../lib/repo.mjs";
import {
  listSnapshots,
  restoreSnapshot,
  takeSnapshot,
} from "../lib/snapshots.mjs";
import { readState } from "../lib/state.mjs";
import { WorkflowError } from "../lib/workflow-error.mjs";
import { adoptCommit } from "../lib/workflow-orders.mjs";
import {
  openProject,
  openProjectForRecovery,
  resultLines,
  saveState,
} from "./support.mjs";

/**
 * snapshots 命令最多列出的快照数.
 * @type {number}
 */
const SNAPSHOT_LIST_LIMIT = 10;

/**
 * 执行快照相关命令.
 *
 * @param {object} options 命令参数.
 * @param {"snapshots" | "restore" | "adopt"} options.command 命令名.
 * @param {string[]} options.positionals 命令名之后的位置参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string} options.now 当前时间, ISO 格式.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 参数不合法时.
 */
export function runSnapshot({ command, positionals, cwd, now }) {
  switch (command) {
    case "snapshots":
      return listSnapshots(
        openProjectForRecovery(cwd).projectRoot,
        SNAPSHOT_LIST_LIMIT,
      ).map(
        (entry) =>
          `- ${shortHash(entry.commit)}: ${entry.time}, 当时的提交 ${shortHash(entry.head)}`,
      );
    case "restore":
      return restore(openProjectForRecovery(cwd), positionals[0], now);
    case "adopt":
      return adopt(openProject(cwd, { allowAnomaly: true }), now);
    default:
      throw new WorkflowError(`未知命令 ${command}.`);
  }
}

/**
 * 恢复状态目录. 恢复前先为当前内容拍一个快照, 便于反悔; 编排会话登记,
 * 初始化信息与技能版本保持恢复前的值, 因为它们描述的是当前环境.
 * 当前状态文件损坏时不保留这些值, 以恢复出的为准.
 *
 * @param {ReturnType<typeof openProjectForRecovery>} recovery 为恢复打开的项目.
 * @param {string | undefined} commit 快照提交或普通提交.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 缺少提交, 或恢复出的内容中没有状态文件时.
 */
function restore(recovery, commit, now) {
  if (commit === undefined) {
    throw new WorkflowError("restore 缺少提交, 先运行 snapshots 查看快照.");
  }
  const { projectRoot, state, spec } = recovery;
  takeSnapshot(projectRoot, { now, head: headCommit(projectRoot) });
  const count = restoreSnapshot(projectRoot, commit);
  const restored = readState(projectRoot);
  if (restored === undefined) {
    throw new WorkflowError(`提交 ${shortHash(commit)} 中没有状态文件.`);
  }
  const environment =
    state === undefined
      ? {}
      : {
          session: state.session,
          init: state.init,
          skillVersion: state.skillVersion,
        };
  const saved = saveState(
    { projectRoot, state: restored, spec },
    {
      ...restored,
      ...environment,
      pendingAnomaly: undefined,
      lastAction: `从 ${shortHash(commit)} 恢复记录`,
    },
    now,
  );
  return [...resultLines(saved), `- 恢复文件: ${count}`];
}

/**
 * 纳入当前 HEAD 与状态目录的当前内容, 并拍摄新快照.
 *
 * @param {import("./support.mjs").ProjectContext} context 项目上下文.
 * @param {string} now 当前时间.
 * @returns {string[]} 输出各行.
 * @throws {WorkflowError} 仓库还没有提交时.
 */
function adopt(context, now) {
  const head = headCommit(context.projectRoot);
  if (head === undefined) {
    throw new WorkflowError("仓库还没有任何提交.");
  }
  return resultLines(
    saveState(
      context,
      {
        ...adoptCommit(context.state, head, `纳入提交 ${shortHash(head)}`),
        pendingAnomaly: undefined,
      },
      now,
    ),
  );
}
