/**
 * @file 状态目录的快照: 存入隐藏引用 `refs/navigator/snapshots`, 不进分支历史.
 *
 * 快照用临时索引生成, 不影响用户的暂存区; `reset`, `checkout`, `clean` 都不会
 * 删除这个引用. 插件脚本目录与草稿目录不纳入快照. 内容与上一个快照相同时不重复存.
 * 状态目录中的文件都视为普通文件, 不记录可执行权限与符号链接.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  BIN_DIRECTORY,
  DRAFTS_DIRECTORY,
  NAVIGATOR_DIRECTORY,
  registryDirectory,
} from "./paths.mjs";
import { readGitBlob, runGit } from "./repo.mjs";

/**
 * 快照引用名.
 * @type {string}
 */
export const SNAPSHOT_REF = "refs/navigator/snapshots";

/**
 * 不纳入快照的子目录, 相对于项目根目录.
 * @type {readonly string[]}
 */
const EXCLUDED_DIRECTORIES = Object.freeze([BIN_DIRECTORY, DRAFTS_DIRECTORY]);

/**
 * 快照提交说明的格式: "snapshot <时间> head <提交>".
 * @type {RegExp}
 */
const SNAPSHOT_SUBJECT_PATTERN = /^snapshot (\S+) head (\S+)$/u;

/**
 * @typedef {object} SnapshotEntry 一个快照.
 * @property {string} commit 快照提交.
 * @property {string} time 拍摄时间.
 * @property {string} head 拍摄时仓库的 HEAD.
 */

/**
 * 普通文件在树对象中的模式.
 * @type {string}
 */
const REGULAR_FILE_MODE = "100644";

/**
 * 计算当前状态目录 (排除脚本与草稿) 的树对象, 不写任何引用.
 *
 * 文件按原始字节存入 (`--no-filters`), 不经过换行转换与 `.gitattributes`
 * 过滤, 保证恢复出的内容与拍摄时逐字节一致.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string | undefined} 树对象哈希; 失败时为 undefined.
 */
export function currentNavigatorTree(worktreeRoot) {
  const files = existsSync(path.join(worktreeRoot, NAVIGATOR_DIRECTORY))
    ? listNavigatorFiles(worktreeRoot)
    : [];
  const hashes =
    files.length === 0
      ? []
      : (runGit(
          worktreeRoot,
          ["hash-object", "-w", "--no-filters", "--stdin-paths"],
          { input: `${files.join("\n")}\n` },
        )?.split("\n") ?? []);
  if (hashes.length !== files.length) {
    return undefined;
  }
  const indexFile = path.join(
    registryDirectory(worktreeRoot),
    `snapshot-index-${process.pid}`,
  );
  mkdirSync(path.dirname(indexFile), { recursive: true });
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    runGit(worktreeRoot, ["read-tree", "--empty"], { env });
    if (files.length > 0) {
      runGit(worktreeRoot, ["update-index", "--add", "--index-info"], {
        env,
        input: files
          .map(
            (file, index) => `${REGULAR_FILE_MODE} ${hashes[index]}\t${file}\n`,
          )
          .join(""),
      });
    }
    return runGit(worktreeRoot, ["write-tree"], { env });
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * 拍摄快照; 与上一个快照内容相同时不重复存.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {{now: string, head: string | undefined}} options 拍摄时间与当前 HEAD.
 * @returns {string | undefined} 新快照提交; 内容未变或失败时为 undefined.
 */
export function takeSnapshot(worktreeRoot, { now, head }) {
  const tree = currentNavigatorTree(worktreeRoot);
  if (tree === undefined) {
    return undefined;
  }
  const previous = runGit(worktreeRoot, [
    "rev-parse",
    "-q",
    "--verify",
    SNAPSHOT_REF,
  ]);
  if (
    previous !== undefined &&
    runGit(worktreeRoot, ["rev-parse", `${previous}^{tree}`]) === tree
  ) {
    return undefined;
  }
  const commit = runGit(worktreeRoot, [
    "commit-tree",
    tree,
    ...(previous === undefined ? [] : ["-p", previous]),
    "-m",
    `snapshot ${now} head ${head ?? "none"}`,
  ]);
  if (commit === undefined) {
    return undefined;
  }
  runGit(worktreeRoot, ["update-ref", SNAPSHOT_REF, commit]);
  return commit;
}

/**
 * 列出最近的快照, 从新到旧.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {number} limit 最多列出的数量.
 * @returns {SnapshotEntry[]} 快照列表.
 */
export function listSnapshots(worktreeRoot, limit) {
  const output = runGit(worktreeRoot, [
    "log",
    `-${limit}`,
    "--format=%H%x09%s",
    SNAPSHOT_REF,
  ]);
  if (output === undefined || output === "") {
    return [];
  }
  return output.split("\n").flatMap((line) => {
    const [commit, subject] = line.split("\t");
    const match = SNAPSHOT_SUBJECT_PATTERN.exec(subject ?? "");
    return match === null ? [] : [{ commit, time: match[1], head: match[2] }];
  });
}

/**
 * 列出状态目录当前内容与最近快照相比改动过的文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string[] | undefined} 改动的文件, 以正斜杠分隔的项目相对路径; 还没有快照时为 undefined.
 */
export function changedSinceLatestSnapshot(worktreeRoot) {
  const latest = runGit(worktreeRoot, [
    "rev-parse",
    "-q",
    "--verify",
    `${SNAPSHOT_REF}^{tree}`,
  ]);
  if (latest === undefined) {
    return undefined;
  }
  const current = currentNavigatorTree(worktreeRoot);
  if (current === latest) {
    return [];
  }
  const output = runGit(worktreeRoot, [
    "-c",
    "core.quotePath=false",
    "diff-tree",
    "-r",
    "--name-only",
    latest,
    current ?? "",
  ]);
  return output === undefined || output === "" ? [] : output.split("\n");
}

/**
 * 把状态目录恢复为某个提交中的内容: 可以是快照提交, 也可以是入库的普通提交.
 * 覆盖该提交中的文件, 删除该提交中没有的文件; 插件脚本与草稿目录不受影响.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} commit 快照提交或普通提交.
 * @returns {number} 恢复的文件数.
 * @throws {Error} 提交不存在, 或其中没有状态目录时.
 */
export function restoreSnapshot(worktreeRoot, commit) {
  const listing = runGit(worktreeRoot, [
    "-c",
    "core.quotePath=false",
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "--",
    NAVIGATOR_DIRECTORY,
  ]);
  if (listing === undefined || listing === "") {
    throw new Error(`snapshots: 提交 ${commit} 不存在, 或其中没有状态目录`);
  }
  const files = listing
    .split("\n")
    .filter(
      (file) =>
        !EXCLUDED_DIRECTORIES.some((directory) =>
          file.startsWith(`${directory}/`),
        ),
    );
  for (const existing of listNavigatorFiles(worktreeRoot)) {
    if (!files.includes(existing)) {
      rmSync(path.join(worktreeRoot, existing), { force: true });
    }
  }
  for (const file of files) {
    const content = readGitBlob(worktreeRoot, `${commit}:${file}`);
    const target = path.join(worktreeRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content ?? Buffer.alloc(0));
  }
  return files.length;
}

/**
 * 列出状态目录中纳入快照范围的文件, 以正斜杠分隔的项目相对路径表示.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string[]} 文件列表.
 */
function listNavigatorFiles(worktreeRoot) {
  const results = [];
  const walk = (relativeDirectory) => {
    if (EXCLUDED_DIRECTORIES.includes(relativeDirectory)) {
      return;
    }
    const absolute = path.join(worktreeRoot, relativeDirectory);
    for (const name of readdirSync(absolute)) {
      const relative = `${relativeDirectory}/${name}`;
      if (statSync(path.join(worktreeRoot, relative)).isDirectory()) {
        walk(relative);
      } else {
        results.push(relative);
      }
    }
  };
  walk(NAVIGATOR_DIRECTORY);
  return results;
}
