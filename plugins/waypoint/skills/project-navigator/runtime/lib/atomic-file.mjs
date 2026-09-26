/**
 * @file 原子写入文件: 先写同目录下的临时文件, 再改名替换目标文件.
 *
 * 读取方不会读到写了一半的内容. Windows 上目标文件被其它进程短暂占用时,
 * 改名会失败, 这里短暂等待后重试.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 改名时遇到文件被占用后的最大重试次数.
 * @type {number}
 */
const RENAME_RETRY_LIMIT = 5;

/**
 * 两次改名重试之间的等待毫秒数.
 * @type {number}
 */
const RENAME_RETRY_DELAY_MS = 50;

/**
 * Windows 上文件被其它进程占用时改名返回的错误码.
 * @type {readonly string[]}
 */
const RETRYABLE_RENAME_CODES = Object.freeze(["EPERM", "EBUSY", "EACCES"]);

/**
 * 原子写入文本文件, 目录不存在时先创建.
 *
 * @param {string} file 目标文件.
 * @param {string} content 文件内容, 以 UTF-8 写入.
 * @returns {void}
 * @throws {Error} 改名重试用尽或遇到其它错误时, 临时文件已删除.
 */
export function writeFileAtomically(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content, "utf8");
  try {
    renameWithRetry(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error(`atomic-file: 无法替换 ${file}`, { cause: error });
  }
}

/**
 * 以 2 空格缩进原子写入 JSON 文件, 以换行结尾.
 *
 * @param {string} file 目标文件.
 * @param {unknown} value 要写入的值.
 * @returns {void}
 * @throws {Error} 写入失败时.
 */
export function writeJsonAtomically(file, value) {
  writeFileAtomically(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 改名替换文件, 遇到占用类错误时短暂等待后重试.
 *
 * @param {string} source 源文件.
 * @param {string} target 目标文件.
 * @returns {void}
 * @throws {Error} 重试用尽或遇到其它错误时.
 */
function renameWithRetry(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      const isRetryable =
        error instanceof Error &&
        RETRYABLE_RENAME_CODES.includes(/** @type {any} */ (error).code);
      if (!isRetryable || attempt >= RENAME_RETRY_LIMIT) {
        throw error;
      }
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        RENAME_RETRY_DELAY_MS,
      );
    }
  }
}
