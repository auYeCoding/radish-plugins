/**
 * @file 筛选器检查测试: 归入筛选器, 新增文件的平铺, 通配符与项目之外的文件.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  checkFilters,
  describeFilterReport,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/filters.mjs";
import { createTemporaryDirectory } from "./helpers.mjs";

/**
 * 测试中工程文件的项目相对路径.
 * @type {string}
 */
const PROJECT_FILE = "app/app.vcxproj";

/**
 * 写入工程文件与筛选器文件, 并运行检查.
 *
 * @param {object} options 参数.
 * @param {string} options.root 项目根目录.
 * @param {string} options.project 工程文件中的项.
 * @param {string | undefined} options.filters 筛选器文件中的项; 不写筛选器文件时为 undefined.
 * @param {readonly string[]} [options.addedFiles] 新增文件的项目相对路径.
 * @returns {import("../../plugins/waypoint/skills/project-navigator/runtime/lib/filters.mjs").FilterReport} 检查结果.
 */
function check({ root, project, filters, addedFiles = [] }) {
  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(
    path.join(root, PROJECT_FILE),
    `<Project><ItemGroup>${project}</ItemGroup></Project>`,
    "utf8",
  );
  if (filters !== undefined) {
    writeFileSync(
      path.join(root, `${PROJECT_FILE}.filters`),
      `<Project><ItemGroup>${filters}</ItemGroup></Project>`,
      "utf8",
    );
  }
  return checkFilters({
    projectRoot: root,
    projectFiles: [PROJECT_FILE],
    addedFiles,
  });
}

test("筛选器: 每个源文件都归入筛选器时没有问题", () => {
  const { root, cleanup } = createTemporaryDirectory();
  try {
    const report = check({
      root,
      project:
        '<ClCompile Include="Main.cpp" /><ClInclude Include="main.h" /><None Include="readme.txt" />',
      filters:
        '<ClCompile Include="main.cpp">\n  <Filter>入口</Filter>\n</ClCompile><ClInclude Include="main.h"><Filter>入口</Filter></ClInclude>',
    });
    assert.deepEqual(report, {
      projectCount: 1,
      itemCount: 2,
      skippedCount: 0,
      problems: [],
    });
    assert.match(describeFilterReport(report)[0], /2 个源文件项, 没有问题/u);
  } finally {
    cleanup();
  }
});

test("筛选器: 没有归入筛选器, 或没有筛选器文件时逐项指出", () => {
  const { root, cleanup } = createTemporaryDirectory();
  try {
    const partial = check({
      root,
      project: '<ClCompile Include="a.cpp" /><ClCompile Include="b.cpp" />',
      filters:
        '<ClCompile Include="a.cpp"><Filter>核心</Filter></ClCompile><ClCompile Include="b.cpp" />',
    });
    assert.deepEqual(partial.problems, [
      `${PROJECT_FILE}: b.cpp 没有归入任何筛选器.`,
    ]);
  } finally {
    cleanup();
  }
  const second = createTemporaryDirectory();
  try {
    const missing = check({
      root: second.root,
      project: '<ClCompile Include="a.cpp" />',
      filters: undefined,
    });
    assert.equal(missing.problems.length, 1);
  } finally {
    second.cleanup();
  }
});

test("筛选器: 只有本切片新增的文件要求平铺, 通配符与项目之外的文件不检查", () => {
  const { root, cleanup } = createTemporaryDirectory();
  try {
    const filtered = (include) =>
      `<ClCompile Include="${include}"><Filter>核心</Filter></ClCompile>`;
    const includes = [
      "old\\legacy.cpp",
      "new\\added.cpp",
      "..\\..\\outside.cpp",
      "gen\\*.cpp",
      "$(IntDir)x.cpp",
    ];
    const report = check({
      root,
      project: includes
        .map((include) => `<ClCompile Include="${include}" />`)
        .join(""),
      filters: includes.map(filtered).join(""),
      addedFiles: ["app/new/added.cpp"],
    });
    assert.equal(report.itemCount, 2);
    assert.equal(report.skippedCount, 2);
    assert.deepEqual(report.problems, [
      `${PROJECT_FILE}: 新增的 new\\added.cpp 没有平铺在工程目录下, 模块用筛选器表达, 不建物理子目录.`,
    ]);
    assert.match(describeFilterReport(report)[0], /另有 2 项带通配符或宏/u);
  } finally {
    cleanup();
  }
});

test("筛选器: 没有工程文件时如实说明", () => {
  assert.match(
    describeFilterReport(
      checkFilters({ projectRoot: ".", projectFiles: [], addedFiles: [] }),
    )[0],
    /没有找到 \.vcxproj 文件/u,
  );
});
