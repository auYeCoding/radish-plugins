# .gitignore 编写规则

以 GitHub 官方维护的 [github/gitignore](https://github.com/github/gitignore) 模板为基础, 按检测到的技术栈组合, 再补充项目特有的规则. 格式遵守 SKILL.md 中的 "规则文件格式": 每条规则上方一行中文注释, 组与组之间空一行.

## 获取模板

每次都在线获取最新模板, 不凭记忆默写:

- **语言与框架模板:**
  - 有 gh 时: `gh api gitignore/templates/<名称> --jq .source`.
  - 没有 gh 时: 用 WebFetch 读取 `https://raw.githubusercontent.com/github/gitignore/main/<名称>.gitignore`.
  - 可用名称列表: `gh api gitignore/templates`.
- **系统与编辑器模板:** 位于仓库的 `Global/` 目录, 用 WebFetch 读取 `https://raw.githubusercontent.com/github/gitignore/main/Global/<名称>.gitignore`.
- **离线或获取失败时:** 退回内置知识编写, 并在确认环节告知用户这些规则未经在线核对.

## 选择模板

| 检测到的内容                                 | 模板                                             |
| -------------------------------------------- | ------------------------------------------------ |
| `package.json`                               | `Node`                                           |
| `*.sln`, `*.csproj`, `*.vcxproj`             | `VisualStudio`                                   |
| `CMakeLists.txt`                             | `CMake`, 以及 `C++` 或 `C`                       |
| 无构建系统的 C/C++ 源文件                    | `C++` 或 `C`                                     |
| `pyproject.toml`, `requirements.txt`, `*.py` | `Python`                                         |
| `go.mod`                                     | `Go`                                             |
| `Cargo.toml`                                 | `Rust`                                           |
| `pom.xml`                                    | `Maven`, `Java`                                  |
| `build.gradle`, `build.gradle.kts`           | `Gradle`, `Java`                                 |
| `*.uproject`                                 | `UnrealEngine`                                   |
| `ProjectSettings/` 与 `Assets/`              | `Unity`                                          |
| `.vscode/`                                   | `Global/VisualStudioCode`                        |
| `.idea/`                                     | `Global/JetBrains`                               |
| 任何项目                                     | `Global/Windows`, `Global/macOS`, `Global/Linux` |

表中没有的技术栈, 从 `gh api gitignore/templates` 的名称列表中选择对应模板.

## 组合方式

- **完整保留规则.** 所选模板中的每一条生效规则都要写入, 不删减, 不改写, 保持模板内的原有顺序; 模板按上表从上到下的顺序排列.
- **去重.** 多个模板中重复的规则只保留第一次出现的那条.
- **注释逐条重写.** 模板原有的注释行 (分节说明, 以及被注释掉的可选规则) 不照搬. 为每条规则单独写一行简体中文注释, 说明它忽略的是什么; 可参考模板原注释的含义.
- **特殊字符原样保留.** 部分规则含不可见字符, 例如 `Global/macOS` 中 `Icon` 规则里的回车符. 写入时必须按原始字节保留; Write 工具无法写入该字符时, 改用命令行写入, 并在确认环节告知用户.

示例:

```gitignore
# CMake 生成的缓存文件
CMakeCache.txt

# CMake 生成的中间文件目录
CMakeFiles/

# C++ 编译生成的目标文件
*.o
```

## 项目特有规则

放在文件最后, 同样每条一组注释:

- **环境变量文件:** `.env` 与 `.env.*`; 若存在 `.env.example` 这类示例文件, 用 `!.env.example` 保留.
- **敏感文件:** 盘点时发现的密钥与凭据文件逐个列出. 无法判断某个文件是否敏感时, 在确认环节询问用户.
- **本地配置:** 如 `.claude/settings.local.json` 以及工具生成的本地缓存目录.

示例:

```gitignore
# 本地环境变量文件, 可能包含密钥
.env

# 按环境区分的本地环境变量文件, 可能包含密钥
.env.*

# 保留环境变量示例文件, 供他人参考配置项
!.env.example

# Claude Code 的本地个人设置
.claude/settings.local.json
```
