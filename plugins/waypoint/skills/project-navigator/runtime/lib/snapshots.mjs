/**
 * @file 状态目录的快照: 存入隐藏引用 `refs/navigator/snapshots`, 不进分支历史.
 *
 * 快照记录插件与受守卫约束的会话最后一次写入的内容, 对账用它发现回退与手工改动.
 * 两种拍法:
 * - 增量快照: 在上一个快照之上只更新本次写入的文件. 日常写入都用这种, 其它文件
 *   即使被回退或手工改动过, 也不会被悄悄并入快照.
 * - 完整快照: 按状态目录的当前内容整体拍摄, 只在初始化自检, 纳入现状与恢复记录
 *   时使用, 这些时刻当前内容已被用户确认.
 *
 * 快照用临时索引生成, 不影响用户的暂存区; `reset`, `checkout`, `clean` 都不会
 * 删除这个引用. 更新引用时核对旧值, 并发写入时重试. 插件脚本目录与草稿目录
 * 不纳入快照. 内容与上一个快照相同时不重复存. 状态目录中的文件都视为普通文件,
 * 不记录可执行权限与符号链接.
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
  isUnderDirectory,
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
 * 快照提交使用的固定身份. 快照只存在隐藏引用中, 不推送也不进入分支历史;
 * 使用固定身份, 用户机器没有配置 Git 用户名与邮箱时也能拍快照.
 * @type {Readonly<Record<string, string>>}
 */
const SNAPSHOT_IDENTITY_ENV = Object.freeze({
  GIT_AUTHOR_NAME: "project-navigator",
  GIT_AUTHOR_EMAIL: "project-navigator@localhost",
  GIT_COMMITTER_NAME: "project-navigator",
  GIT_COMMITTER_EMAIL: "project-navigator@localhost",
});

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
 * 更新快照引用的最多尝试次数; 每次失败说明有其它进程同时更新了快照.
 * @type {number}
 */
const SNAPSHOT_UPDATE_ATTEMPTS = 5;

/**
 * 计算当前状态目录 (排除脚本与草稿) 的树对象, 不写任何引用.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @returns {string | undefined} 树对象哈希; 失败时为 undefined.
 */
export function currentNavigatorTree(worktreeRoot) {
  const files = existsSync(path.join(worktreeRoot, NAVIGATOR_DIRECTORY))
    ? listNavigatorFiles(worktreeRoot)
    : [];
  return withTemporaryIndex(worktreeRoot, (env) => {
    runGit(worktreeRoot, ["read-tree", "--empty"], { env });
    return addFilesToIndex(worktreeRoot, env, files)
      ? runGit(worktreeRoot, ["write-tree"], { env })
      : undefined;
  });
}

/**
 * 拍摄完整快照: 按状态目录的当前内容整体拍摄; 与上一个快照内容相同时不重复存.
 * 只在当前内容已被用户确认时使用, 例如初始化自检, 纳入现状与恢复记录.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {{now: string, head: string | undefined}} options 拍摄时间与当前 HEAD.
 * @returns {string | undefined} 新快照提交; 内容未变或失败时为 undefined.
 */
export function takeSnapshot(worktreeRoot, options) {
  return commitSnapshot(worktreeRoot, options, () =>
    currentNavigatorTree(worktreeRoot),
  );
}

/**
 * 拍摄增量快照: 在上一个快照之上只更新指定的文件, 其余文件保持上一个快照的内容.
 * 指定的文件已被删除时从快照中移除; 插件脚本与草稿目录中的文件忽略. 还没有任何
 * 快照时退回完整快照.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {object} options 拍摄参数.
 * @param {readonly string[]} options.paths 本次写入的文件, 以正斜杠分隔的项目相对路径.
 * @param {string} options.now 拍摄时间.
 * @param {string | undefined} options.head 当前 HEAD.
 * @returns {string | undefined} 新快照提交; 内容未变或失败时为 undefined.
 */
export function recordSnapshotChanges(worktreeRoot, { paths, now, head }) {
  const tracked = [...new Set(paths)].filter((file) => isSnapshotPath(file));
  if (tracked.length === 0) {
    return undefined;
  }
  return commitSnapshot(worktreeRoot, { now, head }, (previousTree) =>
    previousTree === undefined
      ? currentNavigatorTree(worktreeRoot)
      : updatedTree(worktreeRoot, previousTree, tracked),
  );
}

/**
 * 生成新的树对象并提交为快照. 引用更新时核对旧值; 期间有其它进程更新了快照时,
 * 基于新的快照重新生成, 最多重试若干次.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {{now: string, head: string | undefined}} options 拍摄时间与当前 HEAD.
 * @param {(previousTree: string | undefined) => string | undefined} buildTree 由上一个快照的树对象生成新的树对象.
 * @returns {string | undefined} 新快照提交; 内容未变或失败时为 undefined.
 */
function commitSnapshot(worktreeRoot, { now, head }, buildTree) {
  for (let attempt = 0; attempt < SNAPSHOT_UPDATE_ATTEMPTS; attempt += 1) {
    const previous = runGit(worktreeRoot, [
      "rev-parse",
      "-q",
      "--verify",
      SNAPSHOT_REF,
    ]);
    const previousTree =
      previous === undefined
        ? undefined
        : runGit(worktreeRoot, ["rev-parse", `${previous}^{tree}`]);
    const tree = buildTree(previousTree);
    if (tree === undefined || tree === previousTree) {
      return undefined;
    }
    const commit = runGit(
      worktreeRoot,
      [
        "commit-tree",
        tree,
        ...(previous === undefined ? [] : ["-p", previous]),
        "-m",
        `snapshot ${now} head ${head ?? "none"}`,
      ],
      { env: SNAPSHOT_IDENTITY_ENV },
    );
    if (commit === undefined) {
      return undefined;
    }
    const updated = runGit(worktreeRoot, [
      "update-ref",
      SNAPSHOT_REF,
      commit,
      previous ?? "",
    ]);
    if (updated !== undefined) {
      return commit;
    }
  }
  return undefined;
}

/**
 * 在上一个快照的树对象之上更新指定的文件, 生成新的树对象.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} previousTree 上一个快照的树对象.
 * @param {readonly string[]} files 要更新的文件, 以正斜杠分隔的项目相对路径.
 * @returns {string | undefined} 新的树对象; 失败时为 undefined.
 */
function updatedTree(worktreeRoot, previousTree, files) {
  const present = files.filter((file) => isRegularFile(worktreeRoot, file));
  const removed = files.filter((file) => !present.includes(file));
  return withTemporaryIndex(worktreeRoot, (env) => {
    if (
      runGit(worktreeRoot, ["read-tree", previousTree], { env }) === undefined
    ) {
      return undefined;
    }
    if (!addFilesToIndex(worktreeRoot, env, present)) {
      return undefined;
    }
    if (
      removed.length > 0 &&
      runGit(
        worktreeRoot,
        ["update-index", "--force-remove", "--", ...removed],
        { env },
      ) === undefined
    ) {
      return undefined;
    }
    return runGit(worktreeRoot, ["write-tree"], { env });
  });
}

/**
 * 把文件按原始字节存入对象库, 并加入临时索引.
 *
 * 文件按原始字节存入 (`--no-filters`), 不经过换行转换与 `.gitattributes`
 * 过滤, 保证恢复出的内容与拍摄时逐字节一致.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {Record<string, string>} env 指向临时索引的环境变量.
 * @param {readonly string[]} files 文件, 以正斜杠分隔的项目相对路径.
 * @returns {boolean} 全部加入时返回 true.
 */
function addFilesToIndex(worktreeRoot, env, files) {
  if (files.length === 0) {
    return true;
  }
  const hashes =
    runGit(
      worktreeRoot,
      ["hash-object", "-w", "--no-filters", "--stdin-paths"],
      { input: `${files.join("\n")}\n` },
    )?.split("\n") ?? [];
  if (hashes.length !== files.length) {
    return false;
  }
  return (
    runGit(worktreeRoot, ["update-index", "--add", "--index-info"], {
      env,
      input: files
        .map(
          (file, index) => `${REGULAR_FILE_MODE} ${hashes[index]}\t${file}\n`,
        )
        .join(""),
    }) !== undefined
  );
}

/**
 * 使用一个临时索引文件执行操作, 结束后删除; 不影响用户的暂存区.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {(env: Record<string, string>) => string | undefined} action 使用临时索引的操作.
 * @returns {string | undefined} 操作的结果.
 */
function withTemporaryIndex(worktreeRoot, action) {
  const indexFile = path.join(
    registryDirectory(worktreeRoot),
    `snapshot-index-${process.pid}`,
  );
  mkdirSync(path.dirname(indexFile), { recursive: true });
  try {
    return action({ GIT_INDEX_FILE: indexFile });
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * 判断路径是否属于快照范围: 位于状态目录中, 且不在插件脚本与草稿目录中.
 *
 * @param {string} relativePath 以正斜杠分隔的项目相对路径.
 * @returns {boolean} 属于快照范围时返回 true.
 */
function isSnapshotPath(relativePath) {
  return (
    isUnderDirectory(relativePath, NAVIGATOR_DIRECTORY) &&
    !EXCLUDED_DIRECTORIES.some((directory) =>
      isUnderDirectory(relativePath, directory),
    )
  );
}

/**
 * 判断项目中的路径是否为已存在的普通文件.
 *
 * @param {string} worktreeRoot 工作区根目录.
 * @param {string} relativePath 以正斜杠分隔的项目相对路径.
 * @returns {boolean} 是已存在的普通文件时返回 true.
 */
function isRegularFile(worktreeRoot, relativePath) {
  const file = path.join(worktreeRoot, relativePath);
  return existsSync(file) && statSync(file).isFile();
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
