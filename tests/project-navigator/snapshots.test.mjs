/**
 * @file 快照与对账测试: 在临时 Git 仓库中覆盖快照去重, 逐字节恢复, 增量快照,
 * 以及对账的各种情形.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { reconcile } from "../../plugins/waypoint/skills/project-navigator/runtime/lib/reconcile.mjs";
import {
  changedSinceLatestSnapshot,
  listSnapshots,
  recordSnapshotChanges,
  restoreSnapshot,
  takeSnapshot,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/snapshots.mjs";
import {
  createInitialState,
  readState,
  writeState,
} from "../../plugins/waypoint/skills/project-navigator/runtime/lib/state.mjs";
import { commitPaths, createTemporaryRepository, runGit } from "./helpers.mjs";

/**
 * 测试用的时间.
 * @type {string}
 */
const NOW = "2026-09-23T00:00:00.000Z";

/**
 * 在临时仓库中建立状态目录, 写入记录中的最近提交.
 *
 * @param {string} root 仓库根目录.
 * @param {string | null} lastCommit 记录中的最近提交.
 * @returns {void}
 */
function writeNavigatorState(root, lastCommit) {
  mkdirSync(path.join(root, ".navigator", "plan"), { recursive: true });
  const current = readState(root);
  const base =
    current ?? createInitialState({ skillVersion: "0.1.0", now: NOW });
  writeState(root, { ...base, lastCommit }, NOW);
}

/**
 * 在临时仓库中运行一个测试, 结束后清理.
 *
 * @param {string} name 测试名.
 * @param {(root: string, initial: string) => void} body 测试内容, 参数为仓库根目录与首个提交.
 * @returns {void}
 */
function repositoryTest(name, body) {
  test(name, () => {
    const repository = createTemporaryRepository();
    try {
      body(repository.root, runGit(repository.root, ["rev-parse", "HEAD"]));
    } finally {
      repository.cleanup();
    }
  });
}

repositoryTest("快照: 内容不变时不重复拍摄", (root, initial) => {
  writeNavigatorState(root, initial);
  assert.ok(takeSnapshot(root, { now: NOW, head: initial }) !== undefined);
  assert.equal(takeSnapshot(root, { now: NOW, head: initial }), undefined);
  assert.equal(listSnapshots(root, 10).length, 1);
});

repositoryTest(
  "快照: 恢复后逐字节一致, 多出的文件被删除, 脚本与草稿不受影响",
  (root, initial) => {
    writeNavigatorState(root, initial);
    const brief = path.join(root, ".navigator", "plan", "brief.md");
    const original = Buffer.from("# 项目简报\r\n\r\n中文内容\r\n", "utf8");
    writeFileSync(brief, original);
    runGit(root, ["config", "core.autocrlf", "true"]);
    const snapshot = takeSnapshot(root, { now: NOW, head: initial });
    writeFileSync(brief, "改过的内容\n", "utf8");
    const extra = path.join(root, ".navigator", "plan", "extra.md");
    writeFileSync(extra, "多出的文件\n", "utf8");
    const draft = path.join(root, ".navigator", "drafts", "d.json");
    mkdirSync(path.dirname(draft), { recursive: true });
    writeFileSync(draft, "{}", "utf8");
    restoreSnapshot(root, snapshot ?? "");
    assert.deepEqual(readFileSync(brief), original);
    assert.equal(existsSync(extra), false);
    assert.equal(existsSync(draft), true);
  },
);

repositoryTest("快照: 列出与最近快照相比改动的文件", (root, initial) => {
  writeNavigatorState(root, initial);
  assert.equal(changedSinceLatestSnapshot(root), undefined);
  takeSnapshot(root, { now: NOW, head: initial });
  assert.deepEqual(changedSinceLatestSnapshot(root), []);
  writeFileSync(
    path.join(root, ".navigator", "plan", "brief.md"),
    "新\n",
    "utf8",
  );
  assert.deepEqual(changedSinceLatestSnapshot(root), [
    ".navigator/plan/brief.md",
  ]);
});

repositoryTest(
  "快照: 增量快照只并入写入的文件, 其它文件的改动仍被发现",
  (root, initial) => {
    writeNavigatorState(root, initial);
    const plan = path.join(root, ".navigator", "plan");
    writeFileSync(path.join(plan, "a.md"), "甲\n", "utf8");
    writeFileSync(path.join(plan, "b.md"), "乙\n", "utf8");
    takeSnapshot(root, { now: NOW, head: initial });
    writeFileSync(path.join(plan, "a.md"), "甲被改动\n", "utf8");
    writeFileSync(path.join(plan, "b.md"), "乙被写入\n", "utf8");
    writeFileSync(path.join(plan, "c.md"), "丙\n", "utf8");
    const commit = recordSnapshotChanges(root, {
      paths: [".navigator/plan/b.md", ".navigator/plan/c.md"],
      now: NOW,
      head: initial,
    });
    assert.ok(commit !== undefined);
    assert.deepEqual(changedSinceLatestSnapshot(root), [
      ".navigator/plan/a.md",
    ]);
  },
);

repositoryTest("快照: 增量快照中已删除的文件从快照移除", (root, initial) => {
  writeNavigatorState(root, initial);
  const file = path.join(root, ".navigator", "plan", "a.md");
  writeFileSync(file, "甲\n", "utf8");
  takeSnapshot(root, { now: NOW, head: initial });
  rmSync(file);
  recordSnapshotChanges(root, {
    paths: [".navigator/plan/a.md"],
    now: NOW,
    head: initial,
  });
  assert.deepEqual(changedSinceLatestSnapshot(root), []);
});

repositoryTest(
  "快照: 增量快照忽略脚本与草稿目录, 还没有快照时按当前内容整体拍摄",
  (root, initial) => {
    writeNavigatorState(root, initial);
    const draft = path.join(root, ".navigator", "drafts", "d.json");
    mkdirSync(path.dirname(draft), { recursive: true });
    writeFileSync(draft, "{}", "utf8");
    assert.equal(
      recordSnapshotChanges(root, {
        paths: [".navigator/drafts/d.json", "src/app.js"],
        now: NOW,
        head: initial,
      }),
      undefined,
      "范围之外的文件不拍快照",
    );
    assert.ok(
      recordSnapshotChanges(root, {
        paths: [".navigator/state.json"],
        now: NOW,
        head: initial,
      }) !== undefined,
    );
    assert.deepEqual(changedSinceLatestSnapshot(root), []);
  },
);

repositoryTest("对账: 一致", (root, initial) => {
  writeNavigatorState(root, initial);
  takeSnapshot(root, { now: NOW, head: initial });
  assert.equal(reconcile(root, readState(root)).kind, "consistent");
});

repositoryTest("对账: 状态目录被改动", (root, initial) => {
  writeNavigatorState(root, initial);
  takeSnapshot(root, { now: NOW, head: initial });
  writeFileSync(
    path.join(root, ".navigator", "plan", "brief.md"),
    "新\n",
    "utf8",
  );
  const result = reconcile(root, readState(root));
  assert.equal(result.kind, "mismatch");
  assert.deepEqual(result.files, [".navigator/plan/brief.md"]);
});

repositoryTest("对账: 识别自己的提交", (root, initial) => {
  writeNavigatorState(root, initial);
  const own = commitPaths(root, [".navigator"], "feat: 导出");
  takeSnapshot(root, { now: NOW, head: own });
  const result = reconcile(root, readState(root));
  assert.equal(result.kind, "own");
  assert.deepEqual(result.commits, [own]);
});

repositoryTest(
  "对账: 回到自己的提交而丢掉之后的记录时, 判为状态目录与快照不符",
  (root, initial) => {
    writeNavigatorState(root, initial);
    const own = commitPaths(root, [".navigator"], "feat: 导出");
    takeSnapshot(root, { now: NOW, head: own });
    writeState(root, { ...readState(root), step: "research" }, NOW);
    recordSnapshotChanges(root, {
      paths: [".navigator/state.json"],
      now: NOW,
      head: own,
    });
    runGit(root, ["reset", "-q", "--hard", own]);
    const result = reconcile(root, readState(root));
    assert.equal(result.kind, "mismatch");
    assert.deepEqual(result.files, [".navigator/state.json"]);
  },
);

repositoryTest("对账: 陌生提交", (root, initial) => {
  writeNavigatorState(root, initial);
  writeFileSync(path.join(root, "README.md"), "# 改动\n", "utf8");
  const foreign = commitPaths(root, ["README.md"], "docs: 改说明");
  takeSnapshot(root, { now: NOW, head: foreign });
  const result = reconcile(root, readState(root));
  assert.equal(result.kind, "foreign");
  assert.deepEqual(result.commits, [foreign]);
});

repositoryTest("对账: 回退", (root, initial) => {
  writeFileSync(path.join(root, "README.md"), "# 第二版\n", "utf8");
  const second = commitPaths(root, ["README.md"], "docs: 第二版");
  writeNavigatorState(root, second);
  runGit(root, ["reset", "-q", "--hard", initial]);
  takeSnapshot(root, { now: NOW, head: initial });
  const result = reconcile(root, readState(root));
  assert.equal(result.kind, "rollback");
  assert.deepEqual(result.commits, [second]);
});

repositoryTest("对账: squash 合并", (root, initial) => {
  runGit(root, ["checkout", "-q", "-b", "feature"]);
  writeNavigatorState(root, initial);
  const featureCommit = commitPaths(root, [".navigator"], "feat: 导出");
  runGit(root, ["checkout", "-q", "main"]);
  runGit(root, ["merge", "-q", "--squash", "feature"]);
  runGit(root, ["commit", "-qm", "feat: 导出 (squash)"]);
  const squashed = runGit(root, ["rev-parse", "HEAD"]);
  assert.notEqual(squashed, featureCommit);
  const state = { ...readState(root), lastCommit: featureCommit };
  assert.equal(
    reconcile(root, state).kind,
    "squash",
    "HEAD 中的状态目录与记录提交中的相同时判为 squash 合并",
  );
});
