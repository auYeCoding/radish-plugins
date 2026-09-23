# 特殊情况处理

本文件补充 SKILL.md 主流程中的特殊情况. 消息格式与标点规则仍以 SKILL.md 为准.

## 大改动与噪声文件

先用 `git diff HEAD --stat` 或 `git diff HEAD --numstat` 看全局, 再逐个文件读取具体改动. 以下文件不读全文, 只按统计信息概括为一条要点:

- **lock 文件:** `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`. 通常与清单文件 (如 `package.json`) 的改动合并描述, 例如 "升级 prettier 至 3.9.9".
- **生成文件:** 构建产物, 压缩文件 (`*.min.js`, `*.min.css`, `*.map`), 快照文件, 由工具自动生成的代码.
- **二进制文件:** `git diff --numstat` 中增删行数显示为 `-` 的文件. 只写文件名和新增, 修改或删除.

改动文件很多时, 要点按模块或目录归纳, 不逐文件罗列.

## 选择 type

- 一次改动含多种目的时, 按主要目的选 type, 次要改动作为要点列出.
- 只有空白, 缩进, 格式调整, 不改变逻辑: `style`.
- 只有重命名或移动文件, 不改变行为: `refactor`; 仅整理非代码文件时用 `chore`.
- 只改依赖或构建配置: `build`; 只改 CI 配置: `ci`.
- 子模块指针变化: 写明子模块路径, 按其用途选 `build` 或 `chore`.

## 破坏性变更

改动会让已有用法失效时 (删除或重命名公开接口, 改变配置格式, 改变默认行为), 在 type 或 scope 后加 `!`, 例如 `feat(api)!: 移除旧版登录接口`, 并在整体描述中点明影响. 不写 `BREAKING CHANGE:` 页脚, 因为消息必须以整体描述结束.

## 首次提交

仓库还没有任何提交时:

- 所有文件都是新文件, 按目录或模块归纳要点, 不逐文件罗列.
- 以初始化或搭建骨架为主时用 `chore`, 例如 `chore: 初始化项目结构`; 已包含实际功能时按主要内容选 type.
- 由 repo-init 生成的 `.gitignore`, `.editorconfig`, `.gitattributes` 合并为一条要点.

## 撤销提交

`REVERT_HEAD` 存在 (用户执行了 `git revert --no-commit`), 或改动明显是撤销某个历史提交时:

- type 用 `revert`, 主题写被撤销提交的主题, 例如 `revert: 撤销 "feat(parser): 支持多行注释"`.
- 要点列出撤销的具体内容.
- 整体描述写明被撤销提交的短哈希, 看得出原因时一并写上.
