# 维护指南

[English](MAINTAINING.en.md) | 简体中文

本文面向维护者, 列出维护本仓库时需要同步处理的地方, 以及不能只看文件就知道的约定. 贡献流程 (fork, 分支, 提交规范, 本地测试) 见 [CONTRIBUTING.md](CONTRIBUTING.md).

## 改动同步速查表

| 你改了什么                               | 还需要同步的地方                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 任何中文文档                             | 对应的英文文档 (`*.en.md`), 反之亦然                                                              |
| 技能的行为 (`SKILL.md` 或 `references/`) | 该技能的中英文文档, 插件 README 与根 README 中的简介 (若用途变化), `CHANGELOG.md` 的 `Unreleased` |
| 技能的 `description`                     | 重新手动测试自动触发 (见 [发版前手动测试](#发版前手动测试))                                       |
| `shared/punctuation.md`                  | 两个技能都会受影响, 两个都要测试                                                                  |
| 新增技能                                 | 见 [新增技能](#新增技能)                                                                          |
| 新增插件                                 | 见 [新增插件](#新增插件)                                                                          |
| 插件的对外表现                           | 发版: 提升 `plugin.json` 中的 `version`, 否则用户收不到更新                                       |
| CI 任务名 (`validate.yml`)               | GitHub 分支规则中的必需检查名, 否则所有 PR 都无法合并                                             |
| 横幅图展示的内容 (如技能列表)            | 重新生成 PNG, 并在 GitHub 设置中重新上传社交预览图                                                |
| 仓库名, 用户名, 市场名或插件名           | 见 [写死的名称与链接](#写死的名称与链接)                                                          |

## 文档

### 中英双份

以下文档都有中文 (默认) 与英文两份, 同一个 PR 中必须同时更新:

- 根目录与每个插件目录的 `README.md` 与 `README.en.md`.
- 每个技能的 `docs/<技能>.md` 与 `docs/<技能>.en.md`.
- 本文 `MAINTAINING.md` 与 `MAINTAINING.en.md`.

其余文档 (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`) 只写英文. 技能的 `SKILL.md` 与 `references/` 是写给 Claude 的, 用中文.

### 文档与技能规则的分工

- `SKILL.md` 与 `references/` 是技能行为的唯一权威来源. 改行为时先改这里, 再同步文档.
- 技能文档只描述用户能看到的行为, 需要完整规则时链接到 `references/`, 不整段照抄.
- 插件 README 只做导航 (简介, 技能表, 快速上手), 技能细节写在技能文档里.

### 链接与锚点

- 中文标题生成的锚点就是中文本身, 例如 `#安装`. 修改标题会使指向它的链接失效, 改完要检查引用它的地方.
- 文档互相链接时, 中文文档链接中文版, 英文文档链接英文版.

## 技能

### 修改技能

1. 修改 `SKILL.md` 或 `references/` 中的规则.
2. 同步该技能的中英文文档; 用途变化时, 同步插件 README 与根 README 的技能简介.
3. 在插件 `CHANGELOG.md` 的 `## [Unreleased]` 下记录用户能感知的变化.
4. 用 `claude --plugin-dir ./plugins/<插件>` 手动测试受影响的场景.

### 新增技能

按 [CONTRIBUTING.md](CONTRIBUTING.md) 中的 "Adding a skill" 完成技能与文档后, 还要:

- 在根 README 与插件 README (中英文) 的技能表中加一行, 链接到技能文档.
- 更新横幅图中的命令菜单, 重新生成并上传 (见 [社交预览图与横幅](#社交预览图与横幅)).
- 如果新技能也会被 "提交" 之类的说法触发, 检查它与现有技能的 `description` 是否会争抢.

### 设计约定

以下决定都有具体原因, 修改前请先了解:

- **`commit-message` 用一段文字询问 A/B, 不用提问框.** 提问框出现时, 同一条回复中位于它之前的文字可能不会显示, 用户会看不到提交消息.
- **`SKILL.md` 只用 `description`, 不用 `when_to_use`.** `when_to_use` 只有 Claude Code 支持, 其它读取 Agent Skills 的工具会丢弃其中的触发条件. `description` 不超过 1024 字符.
- **共享规则放在插件级的 `shared/` 目录**, 技能用相对路径 `../../shared/<文件>` 引用. 不用 `${CLAUDE_PLUGIN_ROOT}`, 因为编辑器和 GitHub 无法解析它.
- **技能不能引用插件目录以外的文件.** 安装时每个插件单独复制, 这类路径在用户那里会失效.
- **`commit-message` 不调用 `repo-init`, 也不执行 `git init`**, 只提示用户先初始化.
- **`SKILL.md` 不设置 `allowed-tools`.** 只读的 git 命令本来就免确认; `git add`, `git commit`, `git push` 保留权限确认, 作为误触发时的安全网.
- **提交消息经标准输入以 UTF-8 传给 `git commit -F -`.** Windows PowerShell 5.1 的管道默认不是 UTF-8, 需先设置 `$OutputEncoding`, 否则中文会乱码.
- **提交消息严禁任何署名 trailer**, 这条规则不接受用户豁免.

## 插件

### 新增插件

按 [CONTRIBUTING.md](CONTRIBUTING.md) 中的 "Adding a plugin" 完成后, 还要:

- 在根 README (中英文) 中加入该插件的版本徽章. 徽章地址中的 `plugins/waypoint` 换成新插件的目录.
- 视需要更新横幅图.
- 检查 issue 模板中的示例 (`placeholder`) 是否仍然合适.
- 如果新插件由其他人负责, 在 `.github/CODEOWNERS` 中为其目录指定负责人.

`scripts/validate.mjs` 从 `marketplace.json` 读取插件列表, 新插件会被自动校验, 不需要改脚本.

### 重命名插件或技能

- 插件改名后, 在 `marketplace.json` 的 `renames` 字段中登记旧名到新名的映射, 已安装的用户才能平滑迁移.
- 技能改名会改变斜杠命令 (`/<插件>:<技能>`), 需要在 `CHANGELOG.md` 中说明.
- 再按 [写死的名称与链接](#写死的名称与链接) 逐一替换.

## 发布插件版本

每个插件独立发版, 版本号遵循语义化版本, 只写在 `plugin.json` 的 `version` 中. `marketplace.json` 中不要写版本号.

1. 从 `main` 建发版分支, 提升 `plugin.json` 中的 `version`.
2. 在 `CHANGELOG.md` 中把 `## [Unreleased]` 下的条目移到新版本小节 (`## [x.y.z] - YYYY-MM-DD`), 保留空的 `Unreleased`, 并更新文末的版本比较链接 (如有).
3. 开 PR, CI 通过后 squash 合并.
4. 切到最新的 `main`, 打 tag 并推送:

   ```bash
   claude plugin tag ./plugins/<插件> --push
   ```

   它会检查 `plugin.json` 与 `marketplace.json` 是否一致, 然后创建 `<插件>--v<版本>` 格式的 tag.

5. 以该 tag 创建 GitHub Release, 发布说明使用 CHANGELOG 中对应版本的内容:

   ```bash
   gh release create <插件>--v<版本> --title "<插件显示名> <版本>" --notes-file <说明文件>
   ```

6. 验证: README 中的版本徽章显示新版本; 执行 `claude plugin marketplace update radish-plugins` 后, 能用 `claude plugin update <插件>@radish-plugins` 更新到新版本.

忘记提升版本号是最常见的问题: 版本号不变, 用户就收不到任何更新.

## 仓库设置

以下设置保存在 GitHub 上, 不在仓库文件里. 相关文件改动时要一并检查:

| 设置                                  | 关联                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 分支规则 "Protect main"               | 必须通过 PR, 必需检查 "Format and plugin checks", 只允许 squash, 禁止强制推送和删除, 无审批要求, 无人可绕过 |
| 必需检查名 "Format and plugin checks" | 等于 `.github/workflows/validate.yml` 中的任务名 (`jobs.validate.name`), 两边必须一致                       |
| squash 合并的提交说明                 | 标题用 PR 标题, 正文用 PR 内各提交的消息; `CONTRIBUTING.md` 中的说明依赖这一设置                            |
| 合并后自动删除分支                    | 已开启                                                                                                      |
| Discussions                           | 已开启; `.github/ISSUE_TEMPLATE/config.yml` 链接到 `q-a` 分类, 分类改名时同步                               |
| Private vulnerability reporting       | 已开启; `SECURITY.md` 与 issue 模板入口依赖它                                                               |
| 简介与话题标签                        | 定位变化时同步更新                                                                                          |
| 社交预览图                            | 只能在网页上手动上传, 见下一节                                                                              |

## 社交预览图与横幅

- 源文件是 `.github/assets/social-preview.html`, 生成的图片是同目录的 `social-preview.png`. 两份 README 顶部的横幅直接引用这张 PNG.
- 修改源文件后, 按其开头注释中的命令用 Chrome 无头模式重新生成 PNG.
- README 横幅随 PNG 自动更新, 但社交预览图需要在仓库的 Settings > General > Social preview 中重新上传.
- 需要保留换行排版的内容请用 `<pre>`, 否则 prettier 格式化时会把它们合并成一段.

## 依赖与 CI

- **dependabot** 每周检查 npm 依赖 (`prettier`, `@anthropic-ai/claude-code`) 与 GitHub Actions, 并自动提 PR. CI 通过后即可合并.
- **升级 `@anthropic-ai/claude-code` 后**, 新版校验器可能新增警告, 而 CI 以 `--strict` 运行, 警告也会导致失败. 这时要按提示修改插件文件, 而不是去掉 `--strict`.
- **GitHub Actions** 固定到完整的提交 SHA, 并在注释中写明版本, 由 dependabot 统一升级.
- **Node.js:** CI 使用 24; `package.json` 的 `engines` 要求 22 及以上, 因为 Claude Code 的 npm 包要求 22 及以上.
- **提交前**运行 `npm run format` 与 `npm run validate`. CI 执行的是同样的检查.

## 写死的名称与链接

仓库迁移或改名时, 以下位置需要逐一替换. 可以用编辑器全局搜索确认没有遗漏.

| 名称                                 | 出现位置                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仓库地址 `auYeCoding/radish-plugins` | 两份根 README (徽章与链接), `CONTRIBUTING.md`, `SECURITY.md`, `package.json`, `plugin.json` 的 `homepage` 与 `repository`, `.github/ISSUE_TEMPLATE/` 下的文件, PR 模板 |
| 用户名 `auYeCoding`                  | `marketplace.json` 的 `owner`, `plugin.json` 的 `author`, `.github/CODEOWNERS`, `LICENSE`                                                                              |
| 市场名 `radish-plugins`              | `marketplace.json` 的 `name`, README 中的安装, 更新与卸载命令, `CONTRIBUTING.md` 的本地测试, 横幅源文件                                                                |
| 插件名 `waypoint`                    | `marketplace.json`, `plugin.json`, README 的插件表, 命令与版本徽章地址, `CONTRIBUTING.md` 的示例, issue 模板的示例, 横幅源文件                                         |
| 行为准则联系邮箱                     | `CODE_OF_CONDUCT.md`                                                                                                                                                   |

## 本地开发与测试

- **单次会话加载:** `claude --plugin-dir ./plugins/<插件>`, 修改文件后在会话中运行 `/reload-plugins`.
- **完整安装流程:** 在 Claude Code 中执行 `/plugin marketplace add ./`, 再 `/plugin install <插件>@radish-plugins`. 同名市场只能有一个, 已添加 GitHub 上的 `radish-plugins` 时要先移除.
- **快速冒烟测试:** 用 `claude -p "<提示>" --plugin-dir ./plugins/<插件>` 在临时目录中运行. 这种模式没有提问框, 需要提问的地方技能会改用文字列出选项.
- **注意:** 本机若装有其它生成提交消息的技能, 会与 `commit-message` 争抢触发, 测试前先停用.

### 发版前手动测试

发版前在临时目录中逐项确认:

1. "帮我写个提交消息", "write a commit message", "改完了, 提交吧" 能触发 `commit-message`.
2. "解释 rebase 和 merge 的区别", "帮我写 PR 描述", "看看最近 5 次提交改了什么", "更新一下 CHANGELOG" 不会触发.
3. 只有暂存改动时, 消息只覆盖暂存内容.
4. 没有暂存时, 未跟踪的新文件会出现在要点中.
5. 没有改动时回复 "当前没有可提交的更改".
6. `/waypoint:commit-message fix` 使 type 为 `fix`.
7. Claude 改了部分文件, 你另外改了其它文件时, 生成消息前会先询问是否纳入.
8. 只说 "生成" 时, 回复以 `[如何处理?]` 与 A/B 选项结尾; A 提交, B 提交并推送.
9. 说 "帮我提交" 或 "帮我提交并推送" 时直接执行, 消息中没有署名 trailer, 中文不乱码 (Bash 与 PowerShell 各测一次).
10. 要求在消息里加 `Co-Authored-By` 时会被拒绝.
11. 新分支没有上游时自动建立上游; 推送被拒绝时如实报告.
12. 非 Git 目录中, `commit-message` 只提示先运行 `repo-init`.
13. `repo-init` 生成的三个文件每条规则都有一行注释, 组间空一行; `git init` 后会列出待纳入的文件请你确认.
14. 已有 `.editorconfig` 时, `repo-init` 会先询问合并还是跳过.

## 已知的脆弱点

- **技能争抢触发:** 用户装有其它生成提交消息的技能时, Claude 可能选错. 文档中已提示用户停用.
- **不可见的回车符:** `.gitignore` 的 `Global/macOS` 模板有两条规则含回车符 (`Icon\r`), 部分编辑器保存时会破坏它们.
- **Claude Code 的变化:** 新版本可能调整技能 frontmatter 的支持范围或校验规则. 升级后留意 CI 结果与技能行为.
