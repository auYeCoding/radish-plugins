# repo-init

English | [简体中文](repo-init.md)

[Back to WayPoint](../README.en.md)

Surveys the languages and tools in your workspace, writes best-practice `.gitignore`, `.editorconfig`, and `.gitattributes` files with a Simplified Chinese comment for every rule, runs `git init`, and asks you to confirm the files that will be tracked. It never stages or commits anything.

## When to use it

- A new project is about to go under version control and needs reliable ignore and editor rules.
- An existing repository is missing `.gitignore`, `.editorconfig`, or `.gitattributes`.

The skill is not used to clone repositories, configure remotes or credentials, or rewrite existing commit history.

## How to trigger it

**Plain language.** For example, "initialize this repository", "write a .gitignore for this project", or "add an .editorconfig".

**Slash command.** `/waypoint:repo-init`.

## Workflow

1. **Survey the workspace.** Detects manifest files (such as `package.json`, `*.sln`, `CMakeLists.txt`, `pyproject.toml`) and source file types, IDE and system files, sensitive files, existing rule files, and the indentation and encoding (including BOM usage) of existing code.
2. **Write the three rule files.** When a file already exists, it never overwrites it. It shows the differences and asks whether to merge (add only the missing rules) or skip.
3. **Initialize and confirm.**
   - Runs `git init` if the directory is not a Git repository yet, keeping the branch name from your Git configuration.
   - Lists the files that will be tracked, along with the dependency directories, build output, and sensitive files that are ignored, and asks you to confirm.
   - If you ask for changes, it updates the rules and asks again.
4. **Finish.** Summarizes the generated files and suggests running [`/waypoint:commit-message`](commit-message.en.md) for the first commit message.

## Rule file format

All three files use the same format:

- Every rule has a one-line Simplified Chinese comment directly above it that explains what it does or why. The comment and the rule form a group.
- Groups are separated by exactly one blank line, and there are no standalone comments that do not belong to a rule.
- Each file ends with a newline.

```gitignore
# Node.js 依赖安装目录
node_modules/

# 本地环境变量文件, 可能包含密钥
.env
```

## Generation rules

### .gitignore

- Fetches the latest official [github/gitignore](https://github.com/github/gitignore) templates every time, combines the ones that match the detected stack, and adds the Windows, macOS, and Linux system templates.
- Keeps every rule from the selected templates. Rules repeated across templates are kept once.
- Appends project-specific rules, such as `.env` files and secret files found during the survey.
- When offline or when fetching fails, it falls back to built-in knowledge and tells you so during confirmation.

Full rules: [gitignore.md](../skills/repo-init/references/gitignore.md) (in Chinese).

### .editorconfig

- **Common rules:** UTF-8, LF line endings, space indentation with a width of 4, a final newline, and trailing whitespace trimmed on save.
- **Indentation by language:** 2 spaces for JS, TS, JSON, YAML, Markdown, and similar files; tabs for Go and Makefiles.
- **BOM:** UTF-8 with BOM for PowerShell scripts and for MSVC C/C++ projects that do not use `/utf-8`. If existing files mostly have a BOM, it keeps that.
- **Line-ending exceptions:** `.bat`, `.cmd`, and `.sln` files use CRLF when they exist in the workspace.
- **Brace style:** writes the matching properties for C/C++ and C#: opening braces on the same line, braces not indented, namespace contents indented one level, and `else`, `catch`, and similar keywords right after the closing brace.
- **Existing code wins:** when existing code clearly uses a different indentation or encoding, it follows the existing code and tells you during confirmation.

Full rules: [editorconfig.md](../skills/repo-init/references/editorconfig.md) (in Chinese).

### .gitattributes

- `* text=auto eol=lf`: Git detects text and binary files, and text files are stored and checked out with LF.
- CRLF exceptions that match `.editorconfig`.
- `binary` markers for the binary file types that actually exist in the workspace, such as images, fonts, and archives.

Full rules: [gitattributes.md](../skills/repo-init/references/gitattributes.md) (in Chinese).

## Examples

For a CMake project with C++ sources and a `build.bat`, the generated `.gitattributes` is:

```gitattributes
# 由 Git 自动识别文本与二进制, 文本文件统一以 LF 存储和检出
* text=auto eol=lf

# Windows 批处理文件使用 CRLF, 否则 cmd.exe 解析标签跳转会出错
*.bat text eol=crlf
```

An excerpt of the C/C++ section in the matching `.editorconfig`:

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

## FAQ

**Will it overwrite my existing `.gitignore`?**

No. When a file already exists, the skill asks whether to merge or skip.

**Can I use it without the GitHub CLI?**

Yes. Without `gh`, the templates are downloaded from GitHub directly.

**Why are my C++ sources set to UTF-8 with BOM?**

Without the `/utf-8` compiler option, MSVC reads source files that have no BOM in the system code page, which breaks Chinese and other non-ASCII characters. If your project already uses `/utf-8`, the skill keeps UTF-8 without BOM.

**After adding `.gitattributes` to a repository with existing commits, how do I normalize the old files?**

Run `git add --renormalize .`. It stages changes, so the skill only reminds you and never runs it for you.

## Known limitations

- Comments in the rule files are always written in Simplified Chinese.
- Brace and indentation-style rules can be written to `.editorconfig` only for C/C++ (the Visual Studio and VS Code `cpp_*` properties) and C#. Other languages get encoding, line-ending, and indentation rules only.
- The `Global/macOS` `.gitignore` template contains two rules with an invisible carriage return, such as `Icon\r`. Some editors treat it as a line break and can corrupt these rules when saving `.gitignore`.
