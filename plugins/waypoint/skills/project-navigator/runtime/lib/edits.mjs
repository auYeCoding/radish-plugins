/**
 * @file 根据写入类工具的参数, 计算写入后文件的全文.
 *
 * 守卫要在写入发生之前校验结构, 而 Edit 类工具只给出替换片段, 所以先在内存中
 * 重建写入后的全文. 重建失败 (例如原文中找不到要替换的片段) 时返回 undefined,
 * 由工具自己报错, 守卫不代替它判断.
 */

/**
 * 计算写入后的全文.
 *
 * @param {string} toolName 工具名: Write, Edit 或 MultiEdit.
 * @param {Record<string, any>} toolInput 工具参数.
 * @param {string | undefined} currentText 文件当前内容; 文件不存在时为 undefined.
 * @returns {string | undefined} 写入后的全文; 无法计算时为 undefined.
 */
export function reconstructContent(toolName, toolInput, currentText) {
  switch (toolName) {
    case "Write":
      return typeof toolInput.content === "string"
        ? toolInput.content
        : undefined;
    case "Edit":
      return applyEdit(currentText, toolInput);
    case "MultiEdit":
      return (toolInput.edits ?? []).reduce(
        (text, edit) => applyEdit(text, edit),
        currentText,
      );
    default:
      return undefined;
  }
}

/**
 * 在文本上应用一次替换.
 *
 * @param {string | undefined} text 原文.
 * @param {{old_string?: string, new_string?: string, replace_all?: boolean}} edit 替换参数.
 * @returns {string | undefined} 替换后的文本; 原文不存在或找不到片段时为 undefined.
 */
function applyEdit(text, edit) {
  if (
    text === undefined ||
    typeof edit.old_string !== "string" ||
    typeof edit.new_string !== "string" ||
    !text.includes(edit.old_string)
  ) {
    return undefined;
  }
  return edit.replace_all === true
    ? text.split(edit.old_string).join(edit.new_string)
    : text.replace(edit.old_string, () => edit.new_string);
}
