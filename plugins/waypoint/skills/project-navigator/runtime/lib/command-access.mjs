/**
 * @file 插件命令的名称与访问级别, 是命令分发与守卫共用的唯一来源.
 *
 * 会改变编排状态, 或会让会话接管编排的命令只有编排会话可以运行; 只读的命令
 * 所有会话都可以运行, 执行会话要用它们取骨架与核对源码证据. 守卫按会话身份
 * 在命令运行之前放行或拒绝.
 */

/**
 * 访问级别: 只有编排会话可以运行.
 * @type {string}
 */
export const ORCHESTRATOR_ONLY = "orchestrator";

/**
 * 访问级别: 所有会话都可以运行, 命令不改变编排状态.
 * @type {string}
 */
export const SHARED = "shared";

/**
 * 核对源码证据的命令名. 验收子代理只能运行不带参数的这条命令.
 * @type {string}
 */
export const EVIDENCE_COMMAND_NAME = "evidence";

/**
 * 每条插件命令的访问级别, 键为命令名.
 * @type {Readonly<Record<string, string>>}
 */
export const COMMAND_ACCESS = Object.freeze({
  init: ORCHESTRATOR_ONLY,
  uninstall: ORCHESTRATOR_ONLY,
  enter: ORCHESTRATOR_ONLY,
  status: SHARED,
  reply: SHARED,
  template: SHARED,
  stage: ORCHESTRATOR_ONLY,
  step: ORCHESTRATOR_ONLY,
  skip: ORCHESTRATOR_ONLY,
  roadmap: ORCHESTRATOR_ONLY,
  milestone: ORCHESTRATOR_ONLY,
  slice: ORCHESTRATOR_ONLY,
  order: ORCHESTRATOR_ONLY,
  risk: ORCHESTRATOR_ONLY,
  decision: ORCHESTRATOR_ONLY,
  change: ORCHESTRATOR_ONLY,
  "review-brief": ORCHESTRATOR_ONLY,
  "research-brief": ORCHESTRATOR_ONLY,
  [EVIDENCE_COMMAND_NAME]: SHARED,
  snapshots: SHARED,
  restore: ORCHESTRATOR_ONLY,
  adopt: ORCHESTRATOR_ONLY,
  check: ORCHESTRATOR_ONLY,
  standards: ORCHESTRATOR_ONLY,
  codecheck: ORCHESTRATOR_ONLY,
  tools: ORCHESTRATOR_ONLY,
});

/**
 * 所有会话都可以运行的命令名, 按上表的顺序排列, 用于拒绝理由.
 * @type {readonly string[]}
 */
export const SHARED_COMMANDS = Object.freeze(
  Object.keys(COMMAND_ACCESS).filter((name) => COMMAND_ACCESS[name] === SHARED),
);

/**
 * 判断某条命令是否只有编排会话可以运行. 未知的命令名按只有编排会话处理.
 *
 * @param {string} name 命令名.
 * @returns {boolean} 只有编排会话可以运行时返回 true.
 */
export function isOrchestratorOnly(name) {
  return (
    !Object.hasOwn(COMMAND_ACCESS, name) || COMMAND_ACCESS[name] !== SHARED
  );
}
