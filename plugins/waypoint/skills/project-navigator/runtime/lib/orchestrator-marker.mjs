/**
 * @file 编排会话标记: 不做登记, 按会话转录判断一个会话是不是编排会话.
 *
 * 调用技能时 enter 的输出注入技能内容, 其中有一行带本项目专属的标记; 技能内容
 * 记在会话转录中, 所以转录中出现这个标记的会话就是调用过本技能的编排会话.
 * 分叉出的会话复制了原转录, 自然也带着标记, 不需要重新登记. 标记中的编号由项目
 * 路径算出, 源代码中只有前缀, 读源代码的会话不会被误认.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 标记的前缀.
 * @type {string}
 */
const MARKER_PREFIX = "project-navigator 编排标记";

/**
 * 标记中项目编号的十六进制位数.
 * @type {number}
 */
const PROJECT_ID_LENGTH = 12;

/**
 * 生成本项目的编排会话标记.
 *
 * @param {string} projectRoot 项目根目录.
 * @returns {string} 标记文字.
 */
export function orchestratorMarker(projectRoot) {
  const normalized = path.resolve(projectRoot);
  const key =
    process.platform === "win32" ? normalized.toLowerCase() : normalized;
  const id = createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, PROJECT_ID_LENGTH);
  return `${MARKER_PREFIX} ${id}`;
}

/**
 * 判断转录是否来自本项目的编排会话.
 *
 * @param {string | undefined} transcript 转录全文; 读不到时为 undefined.
 * @param {string} projectRoot 项目根目录.
 * @returns {boolean} 转录中有本项目的标记时返回 true.
 */
export function isOrchestratorTranscript(transcript, projectRoot) {
  return (
    transcript !== undefined &&
    transcript.includes(orchestratorMarker(projectRoot))
  );
}

/**
 * 读取 hook 输入中的会话转录.
 *
 * @param {unknown} transcriptPath hook 输入中的转录路径.
 * @returns {string | undefined} 转录全文; 路径缺失或文件不存在时为 undefined.
 */
export function readTranscript(transcriptPath) {
  if (typeof transcriptPath !== "string" || !existsSync(transcriptPath)) {
    return undefined;
  }
  return readFileSync(transcriptPath, "utf8");
}
