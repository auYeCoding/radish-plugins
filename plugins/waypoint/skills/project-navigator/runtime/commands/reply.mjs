/**
 * @file reply 命令: 输出某种回复的填写要求与骨架, "当前进展" 已按状态填好.
 * 不带回复类型时, 列出全部回复类型及其编号与选项组数.
 */

import { buildLaunchPrompt } from "../lib/briefs.mjs";
import { findRepositoryRoot } from "../lib/repo.mjs";
import { renderReplySkeleton } from "../lib/render.mjs";
import { renderReplyGuide } from "../lib/reply-guide.mjs";
import { loadSpec, resolveReplyType } from "../lib/spec.mjs";
import { readState } from "../lib/state.mjs";
import { renderTable } from "../lib/table.mjs";

/**
 * 执行 reply 命令.
 *
 * @param {object} options 命令参数.
 * @param {string} options.cwd 会话工作目录.
 * @param {string | undefined} options.type 回复类型; 省略时列出全部类型.
 * @param {number} options.optionSet 使用第几组选项, 从 1 开始.
 * @returns {string[]} 输出各行.
 * @throws {Error} 回复类型或选项组不存在时.
 */
export function runReply({ cwd, type, optionSet }) {
  const spec = loadSpec();
  if (type === undefined) {
    return listReplyTypes(spec);
  }
  const resolvedType = resolveReplyType(spec, type);
  if (resolvedType === undefined) {
    throw new Error(
      `reply: 未知的回复类型 "${type}", 不带参数运行 reply 查看全部类型`,
    );
  }
  const projectRoot = findRepositoryRoot(cwd);
  const state = projectRoot === undefined ? undefined : readState(projectRoot);
  const order = state?.order ?? null;
  const skeleton = renderReplySkeleton({
    type: resolvedType,
    optionSetIndex: optionSet - 1,
    state,
    spec,
    launchPrompt: order === null ? undefined : buildLaunchPrompt(order),
  });
  return [
    ...renderReplyGuide({
      type: resolvedType,
      role: spec.replies[resolvedType].role,
      spec,
    }),
    ...skeleton.trimEnd().split("\n"),
  ];
}

/**
 * 列出全部回复类型: 类型, 编号, 选项组数.
 *
 * @param {import("../lib/spec.mjs").TemplateSpec} spec 模板规格.
 * @returns {string[]} 表格各行.
 */
function listReplyTypes(spec) {
  return renderTable(
    ["回复类型", "编号", "选项组数"],
    Object.entries(spec.replies).map(([title, reply]) => [
      title,
      reply.id,
      String(reply.optionSets.length),
    ]),
  );
}
