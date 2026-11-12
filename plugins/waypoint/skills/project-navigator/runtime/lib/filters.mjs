/**
 * @file 筛选器检查: Visual Studio 项目用虚拟筛选器分模块时, 确认每个源文件都归入
 * 了筛选器, 新增的源文件没有放进物理子目录.
 *
 * 只用正则解析 `.vcxproj` 与 `.vcxproj.filters` 的常见写法, 不引入 XML 库.
 * 带通配符或宏的项不检查, 只统计数量. 项目目录之外的文件不检查.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { projectRelativePath } from "./paths.mjs";
import { listAddedFiles, listTrackedFiles } from "./repo.mjs";
import { activeSlice } from "./roadmap.mjs";
import { ORGANIZATIONS, SLICE_KINDS } from "./state.mjs";

/**
 * 工程文件的扩展名.
 * @type {string}
 */
const PROJECT_FILE_EXTENSION = ".vcxproj";

/**
 * 筛选器文件相对于工程文件多出的后缀.
 * @type {string}
 */
const FILTERS_SUFFIX = ".filters";

/**
 * 算作源文件的项类型.
 * @type {readonly string[]}
 */
const SOURCE_ITEM_TYPES = Object.freeze([
  "ClCompile",
  "ClInclude",
  "ResourceCompile",
  "MASM",
]);

/**
 * 项的开始标签: 类型与 Include 属性.
 * @type {RegExp}
 */
const ITEM_PATTERN = new RegExp(
  `<(${SOURCE_ITEM_TYPES.join("|")})\\s+Include="([^"]+)"`,
  "gu",
);

/**
 * 筛选器文件中带内容的项: 类型, Include 属性与内容.
 * @type {RegExp}
 */
const FILTERED_ITEM_PATTERN = new RegExp(
  `<(${SOURCE_ITEM_TYPES.join("|")})\\s+Include="([^"]+)"\\s*>([\\s\\S]*?)</\\1>`,
  "gu",
);

/**
 * 项内容中的筛选器名.
 * @type {RegExp}
 */
const FILTER_NAME_PATTERN = /<Filter>\s*([^<]+?)\s*<\/Filter>/u;

/**
 * 不检查的 Include 写法: 通配符与 MSBuild 宏.
 * @type {RegExp}
 */
const DYNAMIC_INCLUDE_PATTERN = /[*?]|\$\(|%\(/u;

/**
 * 路径中的分隔符.
 * @type {RegExp}
 */
const SEPARATOR_PATTERN = /[\\/]/u;

/**
 * @typedef {object} FilterReport 一次筛选器检查的结果.
 * @property {number} projectCount 检查的工程文件数.
 * @property {number} itemCount 检查的源文件项数.
 * @property {number} skippedCount 带通配符或宏, 没有检查的项数.
 * @property {string[]} problems 发现的问题.
 */

/**
 * 检查若干工程文件.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {readonly string[]} options.projectFiles 工程文件的项目相对路径.
 * @param {readonly string[]} options.addedFiles 本切片新增文件的项目相对路径.
 * @returns {FilterReport} 检查结果.
 */
export function checkFilters({ projectRoot, projectFiles, addedFiles }) {
  const added = new Set(addedFiles.map((file) => file.toLowerCase()));
  const reports = projectFiles.map((projectFile) =>
    checkProjectFile({ projectRoot, projectFile, added }),
  );
  return {
    projectCount: projectFiles.length,
    itemCount: reports.reduce((sum, report) => sum + report.itemCount, 0),
    skippedCount: reports.reduce((sum, report) => sum + report.skippedCount, 0),
    problems: reports.flatMap((report) => report.problems),
  };
}

/**
 * 把检查结果写成输出行.
 *
 * @param {FilterReport} report 检查结果.
 * @returns {string[]} 输出各行.
 */
export function describeFilterReport(report) {
  if (report.projectCount === 0) {
    return [`- 筛选器检查: 没有找到 ${PROJECT_FILE_EXTENSION} 文件`];
  }
  const skipped =
    report.skippedCount === 0
      ? ""
      : `, 另有 ${report.skippedCount} 项带通配符或宏, 没有检查`;
  return [
    `- 筛选器检查: ${report.projectCount} 个工程文件, ${report.itemCount} 个源文件项${skipped}, ${report.problems.length === 0 ? "没有问题" : `${report.problems.length} 个问题`}`,
    ...report.problems.map((problem) => `  - ${problem}`),
  ];
}

/**
 * 对项目运行筛选器检查并写成输出行. 只在模块用筛选器表达, 且进行中的切片不是
 * 只产出结论时检查; 新增的文件从切片开工时的提交算起.
 *
 * @param {string} projectRoot 项目根目录.
 * @param {import("./state.mjs").NavigatorState} state 当前状态.
 * @returns {string[]} 输出各行; 不需要检查时为空.
 */
export function runFilterCheck(projectRoot, state) {
  const slice = activeSlice(state)?.slice;
  if (
    state.project.organization !== ORGANIZATIONS.filters ||
    slice?.kind === SLICE_KINDS.findings
  ) {
    return [];
  }
  const baseCommit = state.current?.baseCommit ?? null;
  const addedFiles =
    baseCommit === null ? [] : listAddedFiles(projectRoot, baseCommit);
  const projectFiles = [
    ...new Set([...listTrackedFiles(projectRoot), ...addedFiles]),
  ].filter((file) => file.toLowerCase().endsWith(PROJECT_FILE_EXTENSION));
  return describeFilterReport(
    checkFilters({ projectRoot, projectFiles, addedFiles }),
  );
}

/**
 * 检查一个工程文件.
 *
 * @param {object} options 参数.
 * @param {string} options.projectRoot 项目根目录.
 * @param {string} options.projectFile 工程文件的项目相对路径.
 * @param {ReadonlySet<string>} options.added 本切片新增文件的项目相对路径, 已转小写.
 * @returns {{itemCount: number, skippedCount: number, problems: string[]}} 检查结果.
 */
function checkProjectFile({ projectRoot, projectFile, added }) {
  const absolute = path.join(projectRoot, projectFile);
  const includes = [
    ...readFileSync(absolute, "utf8").matchAll(ITEM_PATTERN),
  ].map((match) => match[2]);
  const filtersFile = `${absolute}${FILTERS_SUFFIX}`;
  const filters = existsSync(filtersFile)
    ? readFilters(readFileSync(filtersFile, "utf8"))
    : new Map();
  const checked = includes.filter(
    (include) => !DYNAMIC_INCLUDE_PATTERN.test(include),
  );
  const inside = checked
    .map((include) => ({
      include,
      relative: projectRelativePath(
        projectRoot,
        path.resolve(path.dirname(absolute), include.replaceAll("\\", "/")),
      ),
    }))
    .filter((item) => item.relative !== undefined);
  return {
    itemCount: inside.length,
    skippedCount: includes.length - checked.length,
    problems: inside.flatMap((item) => [
      ...(filters.has(item.include.toLowerCase())
        ? []
        : [`${projectFile}: ${item.include} 没有归入任何筛选器.`]),
      ...(SEPARATOR_PATTERN.test(item.include) &&
      added.has(/** @type {string} */ (item.relative).toLowerCase())
        ? [
            `${projectFile}: 新增的 ${item.include} 没有平铺在工程目录下, 模块用筛选器表达, 不建物理子目录.`,
          ]
        : []),
    ]),
  };
}

/**
 * 读取筛选器文件中每个项归入的筛选器.
 *
 * @param {string} text 筛选器文件全文.
 * @returns {Map<string, string>} Include 路径 (小写) 到筛选器名的映射; 没有筛选器的项不在其中.
 */
function readFilters(text) {
  return new Map(
    [...text.matchAll(FILTERED_ITEM_PATTERN)]
      .map((match) => [
        match[2].toLowerCase(),
        FILTER_NAME_PATTERN.exec(match[3])?.[1],
      ])
      .filter((entry) => entry[1] !== undefined),
  );
}
