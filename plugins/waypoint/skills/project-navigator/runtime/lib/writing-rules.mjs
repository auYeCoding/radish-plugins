/**
 * @file 写作规则的中文说明, 由规格中的阈值与词表生成.
 *
 * 参考文档的规则表与 reply 命令的填写要求都用这里的说明, 两处写法保持一致.
 */

/**
 * 生成每条写作规则在什么情况下判为违规的说明, 键与规格 writing 一节的键相同.
 *
 * @param {import("./spec.mjs").WritingSpec} writing 写作规则.
 * @returns {Readonly<Record<string, string>>} 各规则的说明.
 */
export function describeWritingRules(writing) {
  return Object.freeze({
    structure: "记录文件的标题, 节与键名不符合规格",
    sentence: `没有标点的片段超过 ${writing.sentence.maxLength} 字`,
    paragraph: `连续的普通文本超过 ${writing.paragraph.maxLines} 行`,
    listLength: `同一层列表超过 ${writing.listLength.maxItems} 项`,
    listDepth: `列表嵌套超过 ${writing.listDepth.maxDepth} 层`,
    bold: `一节中加粗超过 ${writing.bold.maxPerSection} 处`,
    particle: `一个片段中 "${writing.particle.character}" 超过 ${writing.particle.maxPerPhrase} 个`,
    jargon: "使用黑话, 见禁用词",
    metaphor: "使用比喻用词, 见禁用词",
    translationese: "使用翻译腔句式, 见禁用词",
    pronoun: '句首使用没有名词的指代词, 例如 "它", "这是"',
    table: "表格源码的竖线没有按显示宽度对齐",
    length: `回复超过 ${writing.length.maxReplyLines} 行, 或记录文件超过 ${writing.length.maxFileLines} 行 (只追加的记录不限)`,
  });
}
