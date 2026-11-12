/**
 * @file 路线视图: 把状态中的里程与切片写成给人看的 `roadmap.md`.
 *
 * 视图由脚本整份生成, 每次保存状态时重写, 不能直接编辑.
 */

import {
  MILESTONE_LABELS,
  SLICE_KINDS,
  SLICE_STATUSES,
  SLICE_STATUS_LABELS,
} from "./state.mjs";

/**
 * 视图的标题.
 * @type {string}
 */
const TITLE = "# 推进路线";

/**
 * 标题下方的说明.
 * @type {string}
 */
const NOTICE =
  "本文件由 project-navigator 从状态文件生成, 不要直接编辑; 用 roadmap 命令更新路线.";

/**
 * 还没有路线时的内容.
 * @type {string}
 */
const EMPTY_NOTICE = "还没有路线.";

/**
 * 生成路线视图.
 *
 * @param {import("./state.mjs").NavigatorState} state 状态.
 * @returns {string} 文件全文.
 */
export function renderRoadmap(state) {
  const body =
    state.milestones.length === 0
      ? [EMPTY_NOTICE, ""]
      : state.milestones.flatMap((milestone) => [
          `## 里程 ${milestone.id}: ${milestone.name} (${MILESTONE_LABELS[milestone.status]})`,
          "",
          `目标: ${milestone.goal}`,
          "",
          ...(milestone.slices.length === 0
            ? ["切片到这个里程开始时再排."]
            : milestone.slices.map(sliceLine)),
          "",
        ]);
  return [TITLE, "", NOTICE, "", ...body].join("\n");
}

/**
 * 生成一个切片的复选框行.
 *
 * @param {import("./state.mjs").SliceState} slice 切片.
 * @returns {string} 一行.
 */
function sliceLine(slice) {
  const marks = [
    ...(slice.skeleton ? ["最小骨架"] : []),
    ...(slice.kind === SLICE_KINDS.findings ? ["只产出结论"] : []),
    ...(slice.interactive ? ["交互式"] : []),
    ...(slice.status === SLICE_STATUSES.pending ||
    slice.status === SLICE_STATUSES.done
      ? []
      : [SLICE_STATUS_LABELS[slice.status]]),
  ];
  const box = slice.status === SLICE_STATUSES.done ? "x" : " ";
  return `- [${box}] ${slice.id} ${slice.name}${marks.length === 0 ? "" : ` (${marks.join(", ")})`}`;
}
