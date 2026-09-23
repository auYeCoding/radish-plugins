/**
 * @file 工作流操作不合法时抛出的错误类型.
 */

/**
 * 工作流操作不合法时抛出的错误; 错误信息直接展示给编排会话, 写成可以照着改的中文.
 */
export class WorkflowError extends Error {
  /**
   * @param {string} message 错误信息.
   */
  constructor(message) {
    super(message);
    this.name = "WorkflowError";
  }
}
