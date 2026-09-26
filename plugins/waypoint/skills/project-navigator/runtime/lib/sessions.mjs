/**
 * @file 会话身份: 编排会话的登记与接管, 以及判断一个会话是编排会话,
 * 被接管的原编排会话, 执行会话还是其它会话.
 *
 * 编排会话登记在运行期登记目录中, 不写进入库的状态文件: 会话身份描述的是本机
 * 正在运行的会话, 不是项目历史. 放在状态文件中时, 回退状态目录会把身份一起
 * 回退, 仍在运行的编排会话会被悄悄降级.
 */

import {
  readOrchestratorRecord,
  writeOrchestratorRecord,
} from "./registry.mjs";
import { readLegacySessionFields } from "./state.mjs";

/**
 * @typedef {"orchestrator" | "superseded" | "executor" | "other"} SessionRole 会话身份:
 * 编排会话; 曾是编排会话, 编排已被其它会话接管; 执行会话; 其它会话.
 */

/**
 * 读取编排会话登记. 还没有登记文件时, 从结构版本 3 之前写在状态文件中的旧登记
 * 迁移 (只读, 不写入), 让升级前后的身份保持连续.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {import("./registry.mjs").OrchestratorRecord} 登记信息.
 */
export function readOrchestrators(worktreeRoot) {
  const record = readOrchestratorRecord(worktreeRoot);
  if (record !== undefined) {
    return record;
  }
  const legacy = readLegacySessionFields(worktreeRoot);
  return {
    current:
      legacy?.session === undefined
        ? undefined
        : {
            id: legacy.session.id,
            claimedAt: legacy.session.claimedAt ?? "",
          },
    former: legacy?.formerSessions ?? [],
  };
}

/**
 * 确保登记文件存在: 不存在时写入由旧登记迁移来的内容. 升级改写状态文件之前调用,
 * 否则旧登记会随状态文件的改写一起丢失.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {import("./registry.mjs").OrchestratorRecord} 登记信息.
 */
export function ensureOrchestratorRecord(worktreeRoot) {
  const existing = readOrchestratorRecord(worktreeRoot);
  if (existing !== undefined) {
    return existing;
  }
  const migrated = readOrchestrators(worktreeRoot);
  writeOrchestratorRecord(worktreeRoot, migrated);
  return migrated;
}

/**
 * 让会话接管编排并写入登记.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} sessionId 接管编排的会话.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {{previous: string | undefined, record: import("./registry.mjs").OrchestratorRecord}} 接管前的编排会话与接管后的登记.
 */
export function claimOrchestratorSession(worktreeRoot, sessionId, now) {
  const before = ensureOrchestratorRecord(worktreeRoot);
  const record = claimOrchestrator(before, sessionId, now);
  if (record !== before) {
    writeOrchestratorRecord(worktreeRoot, record);
  }
  return { previous: before.current?.id, record };
}

/**
 * 计算接管后的登记: 原编排会话记入曾经的编排会话, 此后不会被登记为执行会话.
 *
 * @param {import("./registry.mjs").OrchestratorRecord} record 接管前的登记.
 * @param {string} sessionId 新的编排会话.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {import("./registry.mjs").OrchestratorRecord} 新登记; 该会话已是编排会话时为原登记.
 */
export function claimOrchestrator(record, sessionId, now) {
  const previous = record.current?.id;
  if (previous === sessionId) {
    return record;
  }
  const former = [
    ...record.former,
    ...(previous === undefined ? [] : [previous]),
  ]
    .filter((id) => id !== sessionId)
    .filter((id, index, all) => all.indexOf(id) === index);
  return { current: { id: sessionId, claimedAt: now }, former };
}

/**
 * 判断会话当前或曾经是编排会话; 这些会话不能登记为执行会话.
 *
 * @param {import("./registry.mjs").OrchestratorRecord} record 编排会话登记.
 * @param {string} sessionId 会话编号.
 * @returns {boolean} 当前或曾经是编排会话时返回 true.
 */
export function isOrchestratorSession(record, sessionId) {
  return record.current?.id === sessionId || record.former.includes(sessionId);
}

/**
 * 判断会话身份. 编排会话以登记为准, 后调用技能的会话会接管编排; 被接管的原编排
 * 会话单独成一类, 以便给出准确的提示; 执行会话以执行登记为准; 其余都是其它会话.
 *
 * @param {object} options 判断参数.
 * @param {import("./registry.mjs").OrchestratorRecord} options.orchestrators 编排会话登记.
 * @param {import("./registry.mjs").ExecutorRecord | undefined} options.executorRecord 该会话的执行登记.
 * @param {string} options.sessionId 会话编号.
 * @returns {SessionRole} 会话身份.
 */
export function identifyRole({ orchestrators, executorRecord, sessionId }) {
  if (sessionId === "") {
    return "other";
  }
  if (orchestrators.current?.id === sessionId) {
    return "orchestrator";
  }
  if (orchestrators.former.includes(sessionId)) {
    return "superseded";
  }
  return executorRecord === undefined ? "other" : "executor";
}
