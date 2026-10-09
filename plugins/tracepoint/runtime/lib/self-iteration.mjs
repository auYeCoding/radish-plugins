/**
 * @file 技能自迭代的通用逻辑: 判断用户消息是否像一次纠正, 规整缺陷记录, 按模式键
 * 去重计数, 判断哪些模式达到提升阈值. 纯逻辑, 不读写文件, 不绑定具体插件或收件目录.
 *
 * 本文件是各插件内置一份的副本 (见仓库 MAINTAINING 的同步登记): tracepoint 与
 * waypoint 各有一份完全相同的逻辑体, 因为插件独立安装时不能引用其它插件的文件.
 * 改动任意一份时, 必须同步另一份.
 *
 * 分工: hook 用 looksLikeCorrection 捕获纠正信号并提示; 代理把事实写成缺陷记录
 * (只记看到什么/依据哪条规则/做了什么/结果如何, 不下 "规则错还是自己错" 的结论);
 * 归因与是否改技能交给人或无上下文子代理, 按固定分类表判; 达阈值才提交给用户.
 */

/**
 * 像一次纠正的用户消息特征. 保守一些, 宁可漏判也不要把普通追问当成纠正.
 * @type {readonly RegExp[]}
 */
const CORRECTION_PATTERNS = Object.freeze([
  /\b(wrong|incorrect|not correct|that'?s not right|you didn'?t|redo|mistake)\b/iu,
  /(不对|错了|搞错|弄错|你没有|没做到|重来|不是这样|又错)/u,
]);

/**
 * 判断一段用户消息是否像一次纠正.
 *
 * @param {string} text 用户消息原文.
 * @returns {boolean} 像纠正时返回 true.
 */
export function looksLikeCorrection(text) {
  return (
    typeof text === "string" &&
    CORRECTION_PATTERNS.some((pattern) => pattern.test(text))
  );
}

/**
 * @typedef {object} DefectRecord 一条缺陷记录, 只含事实.
 * @property {string} plugin 插件命名空间.
 * @property {string} skill 相关技能名.
 * @property {string} rule 相关规则编号或要点; 可为空.
 * @property {string} patternKey 去重用的模式键.
 * @property {string} sawWhat 当时看到什么.
 * @property {string} didWhat 做了什么.
 * @property {string} result 结果如何.
 * @property {string} task 任务标识, 用于统计是否跨任务.
 * @property {string} at 记录时间, ISO 格式.
 */

/**
 * 把任意对象规整成合法的缺陷记录, 容忍缺字段.
 *
 * @param {unknown} value 任意值.
 * @returns {DefectRecord} 规整后的记录.
 */
export function normalizeDefect(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    plugin: asString(source.plugin),
    skill: asString(source.skill),
    rule: asString(source.rule),
    patternKey: asString(source.patternKey),
    sawWhat: asString(source.sawWhat),
    didWhat: asString(source.didWhat),
    result: asString(source.result),
    task: asString(source.task),
    at: asString(source.at),
  };
}

/**
 * @typedef {object} DefectGroup 一个模式键下的缺陷汇总.
 * @property {string} patternKey 模式键.
 * @property {number} count 记录条数.
 * @property {string[]} tasks 涉及的不同任务.
 * @property {string[]} skills 涉及的不同技能.
 * @property {DefectRecord[]} records 原始记录.
 */

/**
 * 按模式键把缺陷记录分组统计.
 *
 * @param {readonly DefectRecord[]} defects 缺陷记录.
 * @returns {DefectGroup[]} 按条数降序的分组.
 */
export function groupDefects(defects) {
  const groups = new Map();
  for (const defect of defects) {
    const key = defect.patternKey === "" ? "(未归类)" : defect.patternKey;
    const group = groups.get(key) ?? {
      patternKey: key,
      count: 0,
      tasks: new Set(),
      skills: new Set(),
      records: [],
    };
    group.count += 1;
    if (defect.task !== "") {
      group.tasks.add(defect.task);
    }
    if (defect.skill !== "") {
      group.skills.add(defect.skill);
    }
    group.records.push(defect);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      patternKey: group.patternKey,
      count: group.count,
      tasks: [...group.tasks],
      skills: [...group.skills],
      records: group.records,
    }))
    .sort((first, second) => second.count - first.count);
}

/**
 * 从分组里挑出达到提升阈值的模式: 复现次数与跨任务数都达标, 且最近一条在时限内.
 * 达阈值只代表值得提请用户看, 是否改技能仍由人决定.
 *
 * @param {readonly DefectGroup[]} groups 分组.
 * @param {object} options 阈值.
 * @param {number} options.minCount 最少复现次数.
 * @param {number} options.minTasks 最少跨任务数.
 * @param {number} options.withinDays 最近一条须在多少天内.
 * @param {Date} options.now 当前时间.
 * @returns {DefectGroup[]} 达阈值的分组.
 */
export function promotablePatterns(
  groups,
  { minCount, minTasks, withinDays, now },
) {
  const cutoff = now.getTime() - withinDays * 24 * 60 * 60 * 1000;
  return groups.filter((group) => {
    if (group.count < minCount || group.tasks.length < minTasks) {
      return false;
    }
    const latest = group.records
      .map((record) => Date.parse(record.at))
      .filter((time) => !Number.isNaN(time));
    return latest.some((time) => time >= cutoff);
  });
}

/**
 * 取字符串; 不是字符串时返回空串.
 *
 * @param {unknown} value 任意值.
 * @returns {string} 字符串.
 */
function asString(value) {
  return typeof value === "string" ? value : "";
}

/**
 * 判断是否为普通对象.
 *
 * @param {unknown} value 任意值.
 * @returns {boolean} 是普通对象时返回 true.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
