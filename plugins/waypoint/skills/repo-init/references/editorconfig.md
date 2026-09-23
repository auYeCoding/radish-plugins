# .editorconfig 编写规则

由通用规则与按需追加的语言分节组成. 只为工作区里实际存在的文件类型追加分节. 格式遵守 SKILL.md 中的 "规则文件格式": 每条规则 (含分节头) 上方一行中文注释, 组与组之间空一行. 下面的示例已按该格式书写, 可直接采用.

**现有代码优先.** 若现有代码已明显采用另一种缩进宽度或编码, 以现有代码为准, 并在确认环节告知用户.

## 通用规则

每个 `.editorconfig` 都以此开头:

```ini
# 顶层配置, 编辑器不再向上级目录查找其它 .editorconfig
root = true

# 以下规则适用于所有文件
[*]

# 文件编码使用 UTF-8, 不带 BOM
charset = utf-8

# 换行符统一为 LF
end_of_line = lf

# 缩进使用空格, 不使用 Tab
indent_style = space

# 缩进宽度为 4 个空格
indent_size = 4

# 文件末尾保留一个换行
insert_final_newline = true

# 保存时删除行尾空白
trim_trailing_whitespace = true
```

## 缩进宽度按语言调整

默认 4 个空格. 以下语言按其官方或主流风格覆盖, 只写工作区中存在的扩展名:

| 文件类型                                                                                        | 规则                 | 依据                           |
| ----------------------------------------------------------------------------------------------- | -------------------- | ------------------------------ |
| JS, TS, JSON, YAML, Markdown, HTML, CSS, Vue, Svelte                                            | `indent_size = 2`    | Prettier 默认风格              |
| XML 与 MSBuild 工程文件 (`*.csproj`, `*.vcxproj`, `*.props`, `*.targets`, `*.resx`, `*.config`) | `indent_size = 2`    | .NET 与 Visual Studio 模板惯例 |
| Go                                                                                              | `indent_style = tab` | gofmt 强制                     |
| Makefile (`Makefile`, `makefile`, `GNUmakefile`, `*.mk`)                                        | `indent_style = tab` | make 语法要求                  |
| `*.sln`                                                                                         | `indent_style = tab` | Visual Studio 生成格式         |

示例:

```ini
# 以下规则适用于 JS, TS, JSON, YAML 与 Markdown 文件
[*.{js,ts,json,yml,yaml,md}]

# 按 Prettier 默认风格使用 2 个空格缩进
indent_size = 2

# 以下规则适用于 Makefile
[{Makefile,makefile,GNUmakefile,*.mk}]

# make 语法要求命令行以 Tab 缩进
indent_style = tab
```

## 编码与 BOM

默认 `utf-8` (不带 BOM). 仅在以下情况对相应文件使用 `charset = utf-8-bom`:

- **PowerShell 脚本** (`*.ps1`, `*.psm1`, `*.psd1`): Windows PowerShell 5.1 把不带 BOM 的文件按系统 ANSI 代码页读取, 非 ASCII 字符会乱码; PSScriptAnalyzer 规则 `PSUseBOMForUnicodeEncodedFile` 也要求带 BOM.
- **MSVC 编译的 C/C++ 源文件**, 且工程未启用 `/utf-8` 编译选项: MSVC 对不带 BOM 的源文件按当前代码页解析. 在 `*.vcxproj` 的 `AdditionalOptions` 或 CMake 编译选项中找到 `/utf-8` 时, 保持 `utf-8`.
- **现有同类文件已普遍带 BOM:** 沿用现状.

示例:

```ini
# 以下规则适用于 PowerShell 脚本
[*.{ps1,psm1,psd1}]

# 带 BOM, 让 Windows PowerShell 5.1 正确识别 UTF-8 编码
charset = utf-8-bom
```

## 换行例外

与 `.gitattributes` 保持一致. 仅当工作区存在这些文件时追加:

```ini
# 以下规则适用于 Windows 批处理文件
[*.{bat,cmd}]

# 使用 CRLF 换行, 否则 cmd.exe 解析标签跳转会出错
end_of_line = crlf

# 以下规则适用于 Visual Studio 解决方案文件
[*.sln]

# 与 Visual Studio 写入的格式一致, 使用 CRLF 换行
end_of_line = crlf

# 与 Visual Studio 写入的格式一致, 使用 Tab 缩进
indent_style = tab
```

## 大括号与缩进风格

目标风格:

- 花括号自身不额外缩进.
- namespace 块内容缩进一级.
- 保留注释原有的缩进, 不强制对齐.
- namespace, class, struct, enum, 函数, 控制块, lambda 的左花括号不换行.
- catch, else, do-while 中的 while 紧跟前一个右花括号, 不换行.

这类规则只有部分语言能在 `.editorconfig` 中表达. 下列属性名均已按官方文档核实; 其它语言不写这类属性, 例如 JS/TS 由 Prettier 负责格式化.

### C/C++

Visual Studio 与 VS Code 的 C/C++ 扩展读取 `cpp_*` 属性 ([微软文档](https://learn.microsoft.com/en-us/visualstudio/ide/cpp-editorconfig-properties)). 以 `.clang-format` 格式化的项目以 `.clang-format` 为准.

```ini
# 以下规则适用于 C/C++ 源文件与头文件
[*.{c,cc,cpp,cxx,c++,h,hh,hpp,hxx,h++,inl,ipp,tlh,tli}]

# 花括号自身不额外缩进
cpp_indent_braces = false

# namespace 块内容缩进一级
cpp_indent_namespace_contents = true

# 保留注释原有的缩进, 不强制对齐
cpp_indent_preserve_comments = true

# namespace 的左花括号不换行
cpp_new_line_before_open_brace_namespace = same_line

# class, struct, enum 等类型的左花括号不换行
cpp_new_line_before_open_brace_type = same_line

# 函数的左花括号不换行
cpp_new_line_before_open_brace_function = same_line

# if, for, while 等控制块的左花括号不换行
cpp_new_line_before_open_brace_block = same_line

# lambda 的左花括号不换行
cpp_new_line_before_open_brace_lambda = same_line

# catch 紧跟前一个右花括号, 不换行
cpp_new_line_before_catch = false

# else 紧跟前一个右花括号, 不换行
cpp_new_line_before_else = false

# do-while 中的 while 紧跟右花括号, 不换行
cpp_new_line_before_while_in_do_while = false
```

### C#

.NET 格式化选项 ([微软文档](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/csharp-formatting-options)). C# 没有单独控制 namespace 缩进, 注释缩进和 do-while 的选项; namespace 内容随 `csharp_indent_block_contents` 缩进.

```ini
# 以下规则适用于 C# 源文件
[*.cs]

# 所有左花括号都不换行
csharp_new_line_before_open_brace = none

# else 紧跟前一个右花括号, 不换行
csharp_new_line_before_else = false

# catch 紧跟前一个右花括号, 不换行
csharp_new_line_before_catch = false

# finally 紧跟前一个右花括号, 不换行
csharp_new_line_before_finally = false

# 花括号自身不额外缩进
csharp_indent_braces = false

# 代码块 (含 namespace) 的内容缩进一级
csharp_indent_block_contents = true
```
