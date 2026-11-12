/**
 * @file 决策记录: 登记决策, 生成追加到 `decisions.md` 的条目.
 *
 * 决策的编号与取代关系记在状态文件中, 条目正文由脚本追加到决策记录, 两边不会
 * 对不上. 已有条目不改写; 被取代的决策在新条目中写明.
 */

import { allocateNumber } from "./numbering.mjs";
import { requireText } from "./validation.mjs";
import { WorkflowError } from "./workflow-error.mjs";

/**
 * 决策记录文件开头的内容.
 * @type {string}
 */
export const DECISIONS_HEADER = [
  "# 决策记录",
  "",
  "本文件由 project-navigator 的 decision add 命令追加, 已有条目不改写.",
  "",
].join("\n");

/**
 * ISO 时间中日期部分的长度.
 * @type {number}
 */
const DATE_LENGTH = 10;

/**
 * @typedef {object} DecisionDraft 决策草稿.
 * @property {string} title 一句话标题.
 * @property {string} decision 决定了什么.
 * @property {string} reason 为什么.
 * @property {string} rejected 放弃了什么.
 * @property {string} [supersedes] 被这条决策取代的决策编号.
 */

/**
 * 登记一条决策.
 *
 * @param {import("./state.mjs").NavigatorState} state 状态.
 * @param {DecisionDraft} draft 决策草稿.
 * @param {string} now 当前时间, ISO 格式.
 * @returns {{state: import("./state.mjs").NavigatorState, entry: string}} 新状态与追加到决策记录的条目.
 * @throws {WorkflowError} 草稿缺少字段, 或被取代的决策不存在时.
 */
export function addDecision(state, draft, now) {
  const title = requireText(draft?.title, "决策标题 (title)");
  const fields = [
    ["日期", now.slice(0, DATE_LENGTH)],
    ["决定", requireText(draft.decision, "决定 (decision)")],
    ["原因", requireText(draft.reason, "原因 (reason)")],
    ["放弃", requireText(draft.rejected, "放弃 (rejected)")],
  ];
  if (
    draft.supersedes !== undefined &&
    !state.decisions.some((decision) => decision.id === draft.supersedes)
  ) {
    throw new WorkflowError(`被取代的决策 ${draft.supersedes} 不存在.`);
  }
  const { id, next } = allocateNumber(state.next, "decision");
  const entry = [
    `## 决策 ${id}: ${title}`,
    "",
    ...fields.map(([key, value]) => `- ${key}: ${value}`),
    ...(draft.supersedes === undefined
      ? []
      : [`- 取代: 决策 ${draft.supersedes}`]),
    "",
  ].join("\n");
  return {
    state: {
      ...state,
      decisions: [
        ...state.decisions.map((decision) =>
          decision.id === draft.supersedes
            ? { ...decision, supersededBy: id }
            : decision,
        ),
        { id, title, supersededBy: null },
      ],
      next,
      lastAction: `登记决策 ${id}`,
    },
    entry,
  };
}
