/**
 * @file 由脚本生成的提示词: 执行会话的启动提示词, 验收子代理与调研子代理的委派提示词.
 *
 * 提示词由脚本生成, 编排会话原样使用; hook 按同一份文字识别执行会话, 核对委派,
 * 防止编排会话在委派时加入倾向性说明或删掉检查项. 这里是这些提示词的唯一来源.
 */

import path from "node:path";

import {
  ENGINEERING_RULES_FILE,
  EXECUTOR_GUIDE_FILE,
  orderFilePath,
} from "./paths.mjs";

/**
 * 一次问题域调研中网络搜索与网页抓取的总次数上限. 立项调研只需形成基本认知,
 * 实测不设上限时一次调研超过 80 次调用, 耗时十几分钟.
 * @type {number}
 */
const RESEARCH_CALL_LIMIT = 20;

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
 * 启动提示词第一行的格式; hook 据此把粘贴它的会话登记为执行会话.
 * @type {RegExp}
 */
export const LAUNCH_PROMPT_PATTERN = /执行工单 (\d{4})/u;

/**
 * 生成执行会话的启动提示词: 身份, 手册与工单路径, 三条硬规则. 细节都在手册与工单中.
 *
 * @param {{id: string, folder: string}} order 当前工单.
 * @returns {string} 启动提示词全文.
 */
export function buildLaunchPrompt(order) {
  return [
    `执行工单 ${order.id}.`,
    "",
    `你是执行会话. 先完整阅读执行手册 ${EXECUTOR_GUIDE_FILE}, 再阅读工单 ${orderFilePath(order.folder, "order")}, 然后按手册中的执行流程工作.`,
    "",
    "三条硬规则:",
    "",
    '1. 先对齐再动手: 按 "开工对齐" 版式回复, 用户选 A 之后才改动业务文件.',
    "2. 只改业务文件与本工单的回执, 不改 .navigator/ 下的其它文件, 不提交, 不推送.",
    '3. 做完或受阻时, 按 "执行完成" 或 "执行受阻" 版式回复, 由用户选择汇报方式.',
  ].join("\n");
}

/**
 * 生成验收委派提示词.
 *
 * @param {object} options 生成参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {{id: string, folder: string, baseCommit: string, kind: string}} options.order 当前工单.
 * @param {readonly string[]} options.testCommands 可运行的测试命令: 代码检查命令与用户授权的测试.
 * @returns {string} 提示词全文.
 */
export function buildReviewBrief({ projectRoot, order, testCommands }) {
  const tests = testCommands.length === 0 ? "无" : testCommands.join("; ");
  return [
    `# 验收委派 ${order.id}`,
    "",
    "你是验收子代理: 只读, 不写任何文件, 不给修改建议, 只报告事实与证据.",
    "",
    "## 验收对象",
    "",
    `- 工单文件: ${path.join(projectRoot, orderFilePath(order.folder, "order"))}`,
    `- 回执文件: ${path.join(projectRoot, orderFilePath(order.folder, "receipt"))}`,
    `- 基准提交: ${order.baseCommit}`,
    `- 工单类型: ${order.kind}`,
    `- 已授权测试: ${tests}`,
    "",
    "## 核对要求",
    "",
    '1. 逐条对照工单的 "验收判据", 每条给出结论 (通过, 不通过, 未验证) 与证据 (文件路径与行号, 或测试输出).',
    `2. 回执一致: 用 git diff ${order.baseCommit} --stat 与回执的 "改动清单" 比对, 列出不一致之处.`,
    "3. 接线核查: 从程序入口追到本工单的新代码, 写出调用链经过的文件路径; 追不到即为未接线.",
    '4. 范围核查: 列出工单 "工作范围" 之外的改动.',
    "5. 测试改动: 检查是否删除, 放宽或跳过了已有测试, 是否放宽了代码检查的规则或加了忽略标记.",
    '6. 测试运行: 只运行 "已授权测试" 中的命令, 原样记录结果; 没有授权的测试不运行.',
    `7. 规范核查: 对照 ${ENGINEERING_RULES_FILE} 检查文档注释, 函数体内注释, 模块边界与粒度 (新功能是否迫使多个已有模块改动内部实现), 单一数据源, 魔法值.`,
    '8. 选型工单另查: 回执 "能力核实" 中每项关键能力是否附源码证据 (仓库地址, 版本或提交, 文件路径与行号); 缺证据的判为未验证.',
    "",
    "## 交回格式",
    "",
    "1. 判据核对: 表格, 列为 判据, 结论, 证据.",
    "2. 专项检查: 依次写 回执一致, 接线核查, 范围核查, 测试改动, 测试运行, 规范核查, 每项一行结论加证据.",
    "3. 人工验收: 需要用户亲手运行才能确认的判据, 写成逐步操作, 命令原样取自回执.",
  ].join("\n");
}
