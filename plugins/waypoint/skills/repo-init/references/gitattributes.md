# .gitattributes 编写规则

格式遵守 SKILL.md 中的 "规则文件格式": 每条规则上方一行中文注释, 组与组之间空一行. 下面的示例已按该格式书写, 可直接采用.

## 基础规则

统一以 LF 存储和检出文本文件, 由 Git 自动识别文本与二进制:

```gitattributes
# 由 Git 自动识别文本与二进制, 文本文件统一以 LF 存储和检出
* text=auto eol=lf
```

## 换行例外

仅当工作区存在这些文件时追加, 并与 `.editorconfig` 保持一致:

```gitattributes
# Windows 批处理文件使用 CRLF, 否则 cmd.exe 解析标签跳转会出错
*.bat text eol=crlf

# Windows 命令脚本使用 CRLF, 原因同批处理文件
*.cmd text eol=crlf

# Visual Studio 解决方案文件使用 CRLF, 与 Visual Studio 写入的格式一致
*.sln text eol=crlf
```

## 二进制文件

为工作区中实际存在的二进制类型逐个标记 `binary`, 避免 Git 对其做换行转换, 文本 diff 或合并. 按类别只写出现过的扩展名, 每个扩展名单独一组:

| 类别       | 常见扩展名                                        |
| ---------- | ------------------------------------------------- |
| 图片       | `png`, `jpg`, `jpeg`, `gif`, `bmp`, `ico`, `webp` |
| 字体       | `ttf`, `otf`, `woff`, `woff2`, `eot`              |
| 压缩包     | `zip`, `7z`, `gz`, `tar`, `rar`                   |
| 文档       | `pdf`, `docx`, `xlsx`, `pptx`                     |
| 可执行与库 | `exe`, `dll`, `so`, `dylib`, `lib`, `a`, `pdb`    |
| 音视频     | `mp3`, `wav`, `mp4`, `mov`                        |

示例:

```gitattributes
# PNG 图片按二进制处理, 不做换行转换, 文本 diff 与合并
*.png binary

# DLL 动态库按二进制处理, 不做换行转换, 文本 diff 与合并
*.dll binary
```

## 已有提交的仓库

在已有提交的仓库中新增或修改 `.gitattributes` 后, 已提交文件的换行不会自动更新. 需要告知用户: 可以执行 `git add --renormalize .` 统一换行, 该命令会暂存改动, 由用户决定何时执行.
