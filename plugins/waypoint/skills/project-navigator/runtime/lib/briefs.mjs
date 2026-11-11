/**
 * @file 由脚本生成的委派提示词: 执行子代理, 验收子代理与调研子代理.
 *
 * 提示词由脚本生成, 编排会话原样使用, 不在其中加入倾向性说明或删掉检查项.
 * 这里是这些提示词的唯一来源.
 */

import path from "node:path";

import {
  COMMAND_NAME,
  ENGINEERING_RULES_FILE,
  orderArtifactsPath,
  orderFilePath,
} from "./paths.mjs";
import { VERDICTS } from "./review-record.mjs";
import {
  EVIDENCE_COMMAND,
  EVIDENCE_SECTION,
  REQUIREMENT_SECTION,
} from "./source-evidence.mjs";
import {
  SELECTION_ORDER_KIND,
  isRecordOnlyOrderKind,
} from "./workflow-orders.mjs";

/**
 * 一次问题域调研中网络搜索与网页抓取的总次数上限. 立项调研只需形成基本认知,
 * 实测不设上限时一次调研超过 80 次调用, 耗时十几分钟.
 * @type {number}
 */
const RESEARCH_CALL_LIMIT = 20;

/**
 * 执行子代理交回给编排会话的要点最多行数.
 * @type {number}
 */
const EXECUTOR_SUMMARY_LINES = 3;

/**
 * 问题域调研提示词的固定框架; 编排会话只在其后填写调研问题.
 * @type {string}
 */
export const RESEARCH_FRAME = [
  "# 问题域调研",
  "",
  "你是调研子代理, 只读, 不写任何文件.",
  "",
  "## 调研规则",
  "",
  "1. 只查问题域: 同类产品与替代方案, 目标使用者与典型场景, 行业做法与标准, 法规与合规约束, 常见失败原因, 关键术语.",
  '2. 不做技术选型, 不比较库或框架; 查到的技术话题只记为 "选型问题".',
  '3. 每条发现附来源地址, 并标明 "事实" 或 "推断"; 推断写明依据哪条来源. 不凭记忆下结论.',
  `4. 控制范围: 目标是形成基本认知, 不求穷尽. 每个调研问题找 2 至 4 个可靠来源, 能回答就停; 网络搜索与网页抓取合计不超过 ${RESEARCH_CALL_LIMIT} 次; 同一网页不重复抓取; 摘录只取支持结论的一两句.`,
  "5. 用简体中文与英文 (ASCII) 标点交回, 每个标点后加一个空格.",
  "",
  "## 交回格式",
  "",
  "依次交回以下各节: 同类方案 (表格: 名称, 做法, 可借鉴之处, 来源), 使用人群, 行业做法, 约束风险, 关键术语 (表格: 术语, 定义, 来源), 选型问题, 结论汇总 (表格: 类别, 内容, 依据, 类别为已知, 假设, 未知), 来源列表.",
  "",
  "## 调研问题",
  "",
].join("\n");

/**
 * 生成执行子代理的委派提示词: 手册与工单的位置, 改动范围, 交回格式.
 * 细节都在执行手册与工单中. 只产出记录的工单 (运行检查与分析) 只写回执与证据文件.
 *
 * @param {object} options 生成参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {{id: string, folder: string, kind: string}} options.order 当前工单.
 * @returns {string} 提示词全文.
 */
export function buildExecutorBrief({ projectRoot, order }) {
  const scopeRule = isRecordOnlyOrderKind(order.kind)
    ? "1. 本工单只产出记录: 只写本工单的回执与工单文件夹 artifacts/ 下的证据文件 (文档, 脚本等), 不改业务文件与 .navigator/ 下的其它文件."
    : "1. 只改业务文件, 本工单的回执与工单文件夹 artifacts/ 下的证据文件, 不改 .navigator/ 下的其它文件.";
  return [
    `# 执行工单 ${order.id}`,
    "",
    `你是执行子代理. 先运行 \`${COMMAND_NAME} ref executor\` 读完执行手册, 再读工单 ${path.join(projectRoot, orderFilePath(order.folder, "order"))}, 然后按手册中的执行流程工作.`,
    "",
    "## 规则",
    "",
    scopeRule,
    `2. 不提交, 不推送, 不运行改变编排状态的插件命令 (例如 \`${COMMAND_NAME} order\`).`,
    `3. 做完或受阻时, 用 \`${COMMAND_NAME} template receipt\` 取骨架 (选型工单加 \`--option 2\`), 写回执 ${path.join(projectRoot, orderFilePath(order.folder, "receipt"))}, 然后结束.`,
    "",
    "## 交回格式",
    "",
    `- 第一行: 执行状态 (完成或受阻) 与回执路径.`,
    `- 其后不超过 ${EXECUTOR_SUMMARY_LINES} 行要点: 受阻时写受阻类型与需要的决定或操作; 完成时写最重要的实现决定与风险.`,
  ].join("\n");
}

/**
 * 生成验收提示词中的接线核查项: 选型工单与只产出记录的工单不改动程序代码, 不做本项.
 *
 * @param {string} kind 工单类型.
 * @returns {string} 核查项全文.
 */
function wiringCheckItem(kind) {
  if (kind === SELECTION_ORDER_KIND) {
    return '3. 接线核查: 选型工单不改动程序代码, 不做本项, 交回时写 "不适用".';
  }
  return isRecordOnlyOrderKind(kind)
    ? '3. 接线核查: 运行检查与分析工单只产出记录, 不改动程序代码, 不做本项, 交回时写 "不适用". 改为在 "范围核查" 中列出本工单文件夹之外被改动的已入库文件.'
    : "3. 接线核查: 从程序入口追到本工单的新代码, 写出调用链经过的文件路径; 追不到即为未接线.";
}

/**
 * 生成验收委派提示词. 交回表格的列取自验收记录的规格, 结论只用三种固定取值.
 *
 * @param {object} options 生成参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {{id: string, folder: string, baseCommit: string, kind: string}} options.order 当前工单.
 * @param {readonly string[]} options.checkCommands 本工单要运行的代码检查命令.
 * @param {import("./spec.mjs").TableSpec} options.criteriaTable 验收记录中判据核对表的规格.
 * @returns {string} 提示词全文.
 */
export function buildReviewBrief({
  projectRoot,
  order,
  checkCommands,
  criteriaTable,
}) {
  const checks = checkCommands.length === 0 ? "无" : checkCommands.join("; ");
  const { pass, fail, unverified } = VERDICTS;
  const verdicts = Object.values(VERDICTS).join(", ");
  return [
    `# 验收委派 ${order.id}`,
    "",
    "你是验收子代理: 只读, 不写任何文件, 不给修改建议, 只报告事实与证据.",
    "",
    "## 验收对象",
    "",
    `- 工单文件: ${path.join(projectRoot, orderFilePath(order.folder, "order"))}`,
    `- 回执文件: ${path.join(projectRoot, orderFilePath(order.folder, "receipt"))}`,
    `- 证据文件目录: ${path.join(projectRoot, orderArtifactsPath(order.folder))}`,
    `- 基准提交: ${order.baseCommit}`,
    `- 工单类型: ${order.kind}`,
    `- 代码检查: ${checks}`,
    "",
    "## 核对要求",
    "",
    `1. 逐条对照工单的 "验收判据", 每条给出结论与证据 (文件路径与行号, 或命令输出). 结论只能是 ${verdicts} 之一, 不用其它说法; 无法确认的写 ${unverified}, 并写明缺少什么.`,
    `2. 回执一致: 用 git diff ${order.baseCommit} --stat 与回执的 "改动清单" 比对, 列出不一致之处.`,
    wiringCheckItem(order.kind),
    '4. 范围核查: 列出工单 "工作范围" 之外的改动.',
    "5. 测试改动: 检查是否删除, 放宽或跳过了已有测试, 是否放宽了代码检查的规则或加了忽略标记.",
    '6. 测试运行: 运行 "代码检查" 中的命令, 以及回执 "测试记录" 中 "测试命令" 列出的命令, 原样记录结果; "外部影响" 中列出的命令 (需要真实账号, 会产生费用或外部副作用) 不运行, 按回执中的输出判断, 证据写明 "依据回执输出".',
    `7. 取证核对: 判据要用 MCP 工具核对时, 按回执 "取证记录" 给出的工具与位置查看, 只做查询类的只读调用, 不发请求, 不清空或修改记录. 证据写工具名, 参数与返回内容摘录; 工具不可用或按位置找不到记录时, 该判据为 ${unverified}.`,
    '8. 证据文件: "证据文件目录" 存在时, 其中是执行子代理留下的产物, 例如抓包原文与复现脚本. 回执或判据引用这些文件时, 按路径读取核对, 证据写文件路径与行号. 目录不存在时跳过本项.',
    `9. 规范核查: 对照 ${ENGINEERING_RULES_FILE} 检查文档注释, 函数体内注释, 模块边界 (回执 "模块划分" 是否与实际改动一致, 新功能是否迫使多个已有模块改动内部实现), 单一数据源, 魔法值.`,
    `10. 选型工单另查: 核对范围只是工单列出的每条需求, 判据核对表中每条需求单独一行. 对照回执 "${REQUIREMENT_SECTION}" 表: 依据是源码的, 运行\`${EVIDENCE_COMMAND}\` 从原仓库按版本取回 "${EVIDENCE_SECTION}" 表引用的源码行, 判断是否支持该需求的结论; 依据是测试的, 运行回执写明的测试命令, 按输出判断. 依据支持结论的为 ${pass}, 不支持的为 ${fail}, 取不到源码或测试无法运行的为 ${unverified}; 需求在表中没有对应行的也为 ${unverified}. 回执其它内容不核对, 不用其它方式获取源码.`,
    "",
    "## 交回格式",
    "",
    `1. 判据核对: 表格, 列为 ${criteriaTable.columns.join(", ")}.`,
    "2. 专项检查: 依次写 回执一致, 接线核查, 范围核查, 测试改动, 测试运行, 规范核查, 每项一行结论加证据.",
    '3. 人工验收: 需要用户亲手运行才能确认的判据, 写成逐步操作, 命令原样取自回执; 回执中没有这样的命令时写 "无".',
  ].join("\n");
}
