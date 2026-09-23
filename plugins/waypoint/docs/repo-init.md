# repo-init

[English](repo-init.en.md) | 简体中文

[返回 WayPoint](../README.md)

盘点工作区用到的语言和工具, 按最佳实践编写 `.gitignore`, `.editorconfig` 与 `.gitattributes`, 每条规则都附一行简体中文注释; 然后执行 `git init`, 列出将纳入版本控制的文件请你确认. 本技能不暂存, 也不提交任何文件.

## 适用场景

- 新项目准备纳入版本控制, 需要一套可靠的忽略规则与编辑规则.
- 已有仓库缺少 `.gitignore`, `.editorconfig` 或 `.gitattributes`, 需要补全.

以下场景不会使用本技能: 克隆仓库, 配置远程或凭据, 修改已有的提交历史.

## 触发方式

**自然语言:** 例如 "帮我初始化这个仓库", "帮我写个 .gitignore", "给项目补一个 .editorconfig".

**斜杠命令:** `/waypoint:repo-init`.

## 使用流程

1. **盘点工作区.** 识别清单文件 (如 `package.json`, `*.sln`, `CMakeLists.txt`, `pyproject.toml`) 与源文件类型, IDE 与系统文件, 敏感文件, 已有的规则文件, 以及现有代码的缩进与编码 (是否带 BOM).
2. **编写三个规则文件.** 同名文件已存在时不直接覆盖, 先列出差异, 询问你是合并 (只补充缺失的规则) 还是跳过.
3. **初始化并确认.**
   - 还不是 Git 仓库时执行 `git init`, 分支名沿用你的 Git 配置.
   - 列出将纳入版本控制的文件, 以及被忽略的依赖目录, 构建产物与敏感文件, 请你确认.
   - 你要求调整时, 按你的意见修改规则后重新确认.
4. **完成.** 简要说明生成了哪些文件, 并提示可以使用 [`/waypoint:commit-message`](commit-message.md) 生成首次提交消息.

## 规则文件格式

三个文件采用同一种格式:

- 每条规则的上一行是一行简体中文注释, 说明它的作用或原因; 注释与规则为一组.
- 组与组之间恰好空一行, 不写不对应任何规则的独立注释.
- 文件以换行符结尾.

```gitignore
# Node.js 依赖安装目录
node_modules/

# 本地环境变量文件, 可能包含密钥
.env
```

## 生成规则

### .gitignore

- 每次都在线获取 GitHub 官方维护的 [github/gitignore](https://github.com/github/gitignore) 模板, 按检测到的技术栈组合, 并加上 Windows, macOS, Linux 的系统模板.
- 完整保留所选模板中的每一条规则, 多个模板中重复的规则只保留一次.
- 在末尾补充项目特有的规则, 例如 `.env` 这类环境变量文件与盘点时发现的密钥文件.
- 离线或获取失败时退回内置知识编写, 并在确认环节告诉你.

完整规则见 [gitignore.md](../skills/repo-init/references/gitignore.md).

### .editorconfig

- **通用规则:** UTF-8, LF 换行, 空格缩进, 缩进宽度 4, 文件末尾保留换行, 保存时删除行尾空白.
- **按语言调整缩进:** JS, TS, JSON, YAML, Markdown 等为 2 个空格; Go 与 Makefile 使用 Tab.
- **BOM:** PowerShell 脚本, 以及未启用 `/utf-8` 的 MSVC C/C++ 项目使用 UTF-8 带 BOM; 现有文件普遍带 BOM 时沿用.
- **换行例外:** 工作区存在 `.bat`, `.cmd`, `.sln` 时, 这些文件使用 CRLF.
- **大括号风格:** 为 C/C++ 与 C# 写入对应属性: 左花括号不换行, 花括号自身不额外缩进, namespace 内容缩进一级, `else`, `catch` 等紧跟右花括号.
- **现有代码优先:** 现有代码明显采用另一种缩进或编码时, 以现有代码为准, 并在确认环节告诉你.

完整规则见 [editorconfig.md](../skills/repo-init/references/editorconfig.md).

### .gitattributes

- `* text=auto eol=lf`: 由 Git 自动识别文本与二进制, 文本文件统一以 LF 存储和检出.
- 与 `.editorconfig` 一致的 CRLF 例外.
- 为工作区中实际存在的二进制类型 (图片, 字体, 压缩包等) 标记 `binary`.

完整规则见 [gitattributes.md](../skills/repo-init/references/gitattributes.md).

## 示例

一个包含 C++ 源文件与 `build.bat` 的 CMake 项目, 生成的 `.gitattributes` 如下:

```gitattributes
# 由 Git 自动识别文本与二进制, 文本文件统一以 LF 存储和检出
* text=auto eol=lf

# Windows 批处理文件使用 CRLF, 否则 cmd.exe 解析标签跳转会出错
*.bat text eol=crlf
```

对应 `.editorconfig` 中的 C/C++ 分节节选:

```ini
# 以下规则适用于 C/C++ 源文件与头文件
[*.{c,cc,cpp,cxx,c++,h,hh,hpp,hxx,h++,inl,ipp,tlh,tli}]

# 花括号自身不额外缩进
cpp_indent_braces = false

# namespace 块内容缩进一级
cpp_indent_namespace_contents = true

# else 紧跟前一个右花括号, 不换行
cpp_new_line_before_else = false
```

## 常见问题

**已有的 `.gitignore` 会被覆盖吗?**

不会. 同名文件已存在时, 本技能会先询问你是合并还是跳过.

**没有安装 GitHub CLI 可以用吗?**

可以. 没有 `gh` 时, 模板改为直接从 GitHub 下载.

**为什么我的 C++ 源文件被设为 UTF-8 带 BOM?**

MSVC 在未启用 `/utf-8` 编译选项时, 会按系统代码页读取不带 BOM 的源文件, 中文等非 ASCII 字符会出错. 如果你的工程已启用 `/utf-8`, 本技能会保持不带 BOM.

**在已有提交的仓库里新增 `.gitattributes` 后, 旧文件的换行怎么统一?**

执行 `git add --renormalize .` 即可统一. 这个命令会暂存改动, 所以本技能只提醒你, 不会自动执行.

## 已知限制

- 规则文件中的注释固定使用简体中文.
- 大括号与缩进风格规则只能为 C/C++ (Visual Studio 与 VS Code 的 `cpp_*` 属性) 和 C# 写入 `.editorconfig`; 其它语言只有编码, 换行与缩进规则.
- `.gitignore` 的 `Global/macOS` 模板中有两条规则含不可见的回车符, 例如 `Icon\r`. 部分编辑器会把它当作换行, 保存 `.gitignore` 时可能损坏这两条规则.
