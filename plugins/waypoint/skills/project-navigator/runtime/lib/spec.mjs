/**
 * @file 读取模板规格 `spec/templates.json`, 并提供按类型查询的方法.
 *
 * 规格是回复与文件结构的唯一来源: 回复骨架的生成, Stop 时的版式校验与参考
 * 文档的生成都从这里读取, 不在其它地方重复定义标题, 键名或选项.
 */

import { readFileSync } from "node:fs";

import { SPEC_FILE } from "./paths.mjs";

/**
 * @typedef {object} TableSpec 节中表格的规格.
 * @property {string[]} columns 表头各列, 按顺序.
 * @property {Record<string, string[]>} [choices] 只能取固定值的列, 键为列名, 值为允许的取值.
 */

/**
 * @typedef {object} SectionSpec 回复或记录文件中一个二级节的规格.
 * @property {string} title 节标题, 4 个汉字.
 * @property {string[]} [keys] 键值行的键名, 按顺序; 省略时节内容不固定.
 * @property {TableSpec} [table] 节中必须有的表格; 与 keys 不同时使用.
 * @property {boolean} [allowLaunchPrompt] 是否允许放启动提示词代码块.
 * @property {string} [source] 内容来源; 为 "order" 时正文摘录自当前工单文件的同名节, 不由编排会话撰写.
 */

/**
 * @typedef {object} OptionSetSpec 一组固定选项的规格.
 * @property {string} title 选项标题, 4 个汉字, 显示在方括号中.
 * @property {string[]} choices 选项文字, 按字母顺序排列, 不含字母前缀.
 */

/**
 * @typedef {object} ReplySpec 一种回复类型的规格.
 * @property {string} id 英文编号, 供命令行参数使用.
 * @property {"orchestrator" | "executor"} role 使用该回复的一方.
 * @property {SectionSpec[]} sections "当前进展" 之后的节, 按顺序.
 * @property {OptionSetSpec[]} optionSets 允许使用的选项组, 回复中必须恰好使用其中一组.
 * @property {string[]} [extraBlocks] 额外允许的代码块种类.
 */

/**
 * @typedef {object} FormatSpec 全局版式规则.
 * @property {number} titleLength 标题与键名的汉字数.
 * @property {number} keyLength 键名的汉字数.
 * @property {number} numberWidth 编号与计数的位数.
 * @property {number} summaryMaxLength 人类总结正文的最大字符数.
 * @property {string} summarySeparator 人类总结代码块的首行.
 * @property {string} summaryLanguage 人类总结代码块的语言标记.
 * @property {string} launchPromptLanguage 启动提示词代码块的语言标记.
 * @property {string} emptyValue 字段不适用时写的值.
 * @property {string} progressTitle 进展节的标题.
 * @property {string[]} progressKeys 进展节的键名, 按顺序.
 */

/**
 * @typedef {object} WritingRule 一条写作规则.
 * @property {string} label 问题类别, 4 个汉字, 用于报告.
 * @property {"problem" | "hint"} severity 级别: 问题必须修改, 提示供参考.
 */

/**
 * @typedef {object} WritingSpec 写作规则, 各条规则在 WritingRule 之外另有自己的阈值或词表.
 * @property {WritingRule} structure 结构不符合文件规格.
 * @property {WritingRule & {maxLength: number, hintLength: number}} sentence 无标点片段的字数.
 * @property {WritingRule & {maxLines: number}} paragraph 段落行数.
 * @property {WritingRule & {maxItems: number}} listLength 同一层列表的项数.
 * @property {WritingRule & {maxDepth: number}} listDepth 列表嵌套层数.
 * @property {WritingRule & {maxPerSection: number}} bold 每节加粗次数.
 * @property {WritingRule & {character: string, maxPerPhrase: number}} particle 每个片段中 "的" 的个数.
 * @property {WritingRule & {words: string[]}} jargon 黑话词表.
 * @property {WritingRule & {words: string[]}} metaphor 比喻词表.
 * @property {WritingRule & {patterns: {pattern: string, advice: string}[]}} translationese 翻译腔句式.
 * @property {WritingRule & {patterns: string[]}} pronoun 句首裸指代词.
 * @property {WritingRule} table 表格源码未对齐.
 * @property {WritingRule & {maxReplyLines: number, maxFileLines: number}} length 篇幅上限.
 */

/**
 * @typedef {object} TemplateSpec 模板规格全文.
 * @property {number} version 规格版本.
 * @property {FormatSpec} format 全局版式规则.
 * @property {WritingSpec} writing 写作规则.
 * @property {string[]} stages 各阶段名称, 下标为阶段编号.
 * @property {[string, string][]} processTerms 流程术语及其定义, init 写入术语表.
 * @property {Record<string, ReplySpec>} replies 各回复类型的规格, 键为一级标题.
 * @property {Record<string, import("./file-checks.mjs").FileSpec>} files 各记录文件的规格.
 */

/**
 * 读取模板规格.
 *
 * @param {string} [file] 规格文件路径; 默认为技能目录中的规格.
 * @returns {TemplateSpec} 规格.
 */
export function loadSpec(file = SPEC_FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * 查询某种回复类型的规格.
 *
 * @param {TemplateSpec} spec 模板规格.
 * @param {string} type 回复类型, 即一级标题.
 * @returns {ReplySpec | undefined} 规格; 类型不存在时为 undefined.
 */
export function findReply(spec, type) {
  return Object.hasOwn(spec.replies, type) ? spec.replies[type] : undefined;
}

/**
 * 把回复类型的中文标题或英文编号解析为中文标题. 命令行参数可以使用英文编号,
 * 避免部分终端传递中文参数时出现乱码.
 *
 * @param {TemplateSpec} spec 模板规格.
 * @param {string} nameOrId 中文标题或英文编号.
 * @returns {string | undefined} 中文标题; 两者都不匹配时为 undefined.
 */
export function resolveReplyType(spec, nameOrId) {
  if (Object.hasOwn(spec.replies, nameOrId)) {
    return nameOrId;
  }
  return Object.entries(spec.replies).find(
    ([, reply]) => reply.id === nameOrId,
  )?.[0];
}

/**
 * 返回最后一个阶段的编号, 用作 "当前阶段" 中的分母.
 *
 * @param {TemplateSpec} spec 模板规格.
 * @returns {number} 最后一个阶段的编号.
 */
export function lastStageNumber(spec) {
  return spec.stages.length - 1;
}
