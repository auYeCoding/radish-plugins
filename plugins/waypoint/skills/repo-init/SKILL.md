---
name: repo-init
description: 为工作区初始化 Git 仓库: 盘点项目技术栈, 按最佳实践编写 .gitignore, .editorconfig 与 .gitattributes (统一 UTF-8, LF 换行, 空格缩进, 每条规则附中文注释), 执行 git init 并请用户确认将纳入版本控制的文件. Initializes a Git repository with best-practice, fully commented .gitignore, .editorconfig and .gitattributes files. 用户要求初始化 Git 仓库, 或为项目编写, 生成, 补全 .gitignore, .editorconfig, .gitattributes 时使用. 不用于克隆仓库, 配置远程或凭据, 以及修改已有的提交历史.
---

# 初始化 Git 仓库

先弄清工作区里有什么, 再按最佳实践编写三个规则文件, 最后初始化仓库并请用户确认哪些文件会纳入版本控制. 忽略规则一旦出错, 密钥, 本地配置或构建产物就可能进入提交历史, 清除代价很大, 所以每一步都以工作区的实际情况为依据.

本技能不暂存任何文件, 也不提交.

## 第一步: 盘点工作区

用 Glob, Grep 与 Read 收集以下信息, 盘点时跳过 `node_modules`, `.git` 等依赖与生成目录:

- **技术栈:** 清单文件 (如 `package.json`, `*.sln`, `*.csproj`, `*.vcxproj`, `CMakeLists.txt`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`) 与源文件扩展名分布.
- **IDE 与系统文件:** `.vs/`, `.vscode/`, `.idea/`, `*.user`, `.DS_Store`, `Thumbs.db` 等.
- **敏感文件:** `.env`, `.env.*`, `*.pem`, `*.key`, `*.pfx`, `id_rsa`, `credentials*` 等.
- **已有规则文件:** `.gitignore`, `.editorconfig`, `.gitattributes` 是否已存在.
- **现有代码风格:** 抽查有代表性的源文件, 记下缩进方式与宽度, 以及是否带 UTF-8 BOM. 检查 BOM 的命令:
  - Bash: `head -c 3 <文件> | od -An -tx1`, 输出 `ef bb bf` 表示带 BOM.
  - PowerShell 7: `Get-Content -AsByteStream -TotalCount 3 <文件>`, 输出 `239 187 191` 表示带 BOM.

## 第二步: 编写规则文件

按下列参考文件逐个生成. 参考文件没有覆盖的语言或工具, 先查该语言或工具的官方文档, 只写能核实的属性名和值, 不编造:

- `.gitignore`: 见 [gitignore.md](references/gitignore.md).
- `.editorconfig`: 见 [editorconfig.md](references/editorconfig.md).
- `.gitattributes`: 见 [gitattributes.md](references/gitattributes.md).

`.editorconfig` 与 `.gitattributes` 对同一类文件的换行规则必须一致.

**同名文件已存在时不直接覆盖.** 对比现有内容与新生成的内容, 用 AskUserQuestion 询问, 并把两者差异的要点写在问题文字里 (提问框之前输出的文字用户可能看不到), 选项为 "合并" 和 "跳过":

- 合并: 保留现有规则, 只补充缺失项; 补充的规则按下文格式书写.
- 跳过: 该文件保持原样.

## 规则文件格式

三个文件都必须采用以下格式:

1. **每条规则都有注释.** 每条规则 (包括 `.editorconfig` 中的 `root = true` 与 `[...]` 分节头) 的上一行是一行以 `#` 开头的简体中文注释, 说明这条规则的作用或原因. 注释与它下面的规则为一组.
2. **组与组之间恰好空一行.** 不连续空多行, 也不写不对应任何规则的独立注释 (如分节标题).
3. **文件以换行符结尾**, 最后一组之后不留多余的空行.
4. 注释中的文字遵守 [punctuation.md](../../shared/punctuation.md) 中的标点规则, 写之前先读取该文件.

示例:

```gitignore
# Node.js 依赖安装目录
node_modules/

# 本地环境变量文件, 可能包含密钥
.env
```

## 第三步: 初始化并确认

1. 已经是 Git 仓库 (`git rev-parse --is-inside-work-tree` 成功) 时跳过初始化. 否则执行 `git init`, 分支名沿用用户的 Git 配置, 不另行指定.
2. 运行 `git status --short -uall`, 列出将纳入版本控制的文件. 再运行 `git status --short --ignored`, 核对依赖目录, 构建产物与敏感文件确实被忽略.
3. 用 AskUserQuestion 请用户确认. 问题中给出将纳入的文件 (文件多时按目录归纳) 和被忽略的要点; 选项为 "确认无误" 和 "需要调整".
   - 需要调整: 按用户意见修改规则文件, 然后重新执行第 2, 3 步.
   - AskUserQuestion 不可用: 用文字列出上述信息, 然后停下等待回答.
4. 用户确认后, 简要说明生成了哪些文件及要点, 并提示可以使用 `/waypoint:commit-message` 生成首次提交消息.
