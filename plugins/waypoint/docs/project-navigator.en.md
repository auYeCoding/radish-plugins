# project-navigator

English | [简体中文](project-navigator.md)

[Back to WayPoint](../README.en.md)

Guides a large project from a single high-level idea through problem-domain research, framing, technology selection, and a minimal runnable skeleton, then moves it forward in vertical slices and milestones, handling changes in requirements or direction along the way.

The session that invokes this skill only plans, records, issues work orders, and organizes reviews. It is called the orchestrator session. Writing code, choosing technologies, and testing happen in separate sessions you open, called executor sessions. Every step is recorded in the repository, so any new session can pick up where the last one left off.

The skill's replies and records are written in Simplified Chinese.

## When to use it

- Starting a project that will take weeks or longer, when you want the problem, scope, and main flow clear before writing code.
- Moving an existing project forward, with a clear goal, acceptance criteria, and review for every change.
- Handling a change in requirements mid-project, by assessing its impact and adjusting the plan.

It is not meant for small tasks such as fixing a typo, patching a small bug, or writing a one-off script. Just ask Claude directly for those.

## Requirements

- [Git](https://git-scm.com): the project must be a Git repository with at least one commit. If it is not a repository yet, run [`/waypoint:repo-init`](repo-init.en.md) first.
- [Node.js](https://nodejs.org) 22 or later: the guard hooks and the record scripts run on Node.js.
- Start Claude Code in the project root. Executor sessions do not use worktrees.
- During selection, the public git repositories (https) of the chosen dependencies must be reachable: the review fetches source code from the original repositories to verify the evidence.

## Invocation

The skill runs only when you invoke it explicitly. Plain-language requests never trigger it:

```text
/waypoint:project-navigator [init | check | uninstall | initial requirement]
```

- No argument: show the current progress and continue as prompted.
- `init`: initialize the project.
- `check`: run a checkup on the records.
- `uninstall`: remove the guard hooks and keep every record.
- Any other text: the initial requirement, for example `/waypoint:project-navigator 做一个团队周报汇总工具`.

Invoking the skill from any new session takes over orchestration and resumes from the last position. The previous orchestrator session loses its orchestration rights.

## Quick start

Take "做一个团队周报汇总工具" (build a tool that combines a team's weekly reports) as an example, starting from a new repository that only has a README. Every reply ends with an option block, so you only need to reply with a letter. To add details, write them after the letter, for example `B 第 3 条假设不对, 我们用飞书` (B, assumption 3 is wrong, we use Feishu).

### First invocation

1. Start Claude Code in the project root and enter `/waypoint:project-navigator 做一个团队周报汇总工具`.
2. The skill replies with "初始设置" (setup), listing the checks and what it will write. Reply `A`. In the default permission mode, Claude Code asks you to approve the initialization command once.
3. After the self-check passes, the skill replies with "首次接入" (first entry). Reply `A` for a new project, or `B` for a project with existing code.

### Framing and main flow

1. "需求理解" (requirement understanding) lists your own words separately from the skill's assumptions. Reply `B` with the numbers of any wrong assumptions, or `A` if they are right.
2. The skill sends the researcher subagent to look into similar products, users, industry practice, and constraints, then replies with "调研报告" (research report). Research needs web access, which Claude Code may ask you to approve, and usually takes a few minutes.
3. Each "头脑风暴" (brainstorming) round asks at most three questions, often with candidate answers and a recommended one. Answer by number. The skill asks for your consent before converging.
4. The skill writes the project brief and replies with "产出确认" (confirm output). The main flow and roadmap that follow are confirmed the same way.

### Selection and the first work order

1. "规范对照" (standards comparison) lists conflicting standards for you to decide one by one, and finally asks for the code comment language.
2. Each selection question gets a work order, announced with "工单发布" (work order issued). Then:
   1. Open a new Claude Code session in the project root and paste the launch prompt from the "后续操作" (next steps) section of the reply.
   2. After reading the work order, the executor replies with "开工对齐" (alignment). Check its plan; it starts working only after you reply `A`.
   3. When done, the executor replies with "执行完成" (done). Reply `A` to have it write the receipt file, then go back to the orchestrator session and reply `A` in "等待回执" (awaiting receipt).
3. The orchestrator sends the reviewer subagent to check the work and replies with "验收报告" (review report), listing steps for you to verify by hand. Reply `A` once everything checks out.
4. In "确认提交" (confirm commit), choose to commit only, commit and push, or hand over to commit-message.

The skeleton and every later slice move forward through the same work order round trip.

### Every time after that

Open a new session in the project root and enter `/waypoint:project-navigator` with no argument. The skill compares the records with the repository, then replies with "恢复进度" (resume), stating where you left off and what comes next.

## Initialization

On the first invocation, the skill checks the environment and asks whether to set up. When you choose A, it:

1. Creates the state directory `.navigator/`: the state file, the executor guide, the glossary, and the runtime scripts.
2. Adds guard hooks and allow rules to `.claude/settings.json`, keeping your existing settings. The allow rules are also copied to the machine-local `.claude/settings.local.json`, which is not committed.
3. Runs a self-check: it deliberately attempts one forbidden write to confirm the guard hooks are active.

Commit `.navigator/` and `.claude/settings.json`, so records survive rollbacks and moving to another machine. The skill guards against files being left out in three places:

- The `.gitignore` inside `.navigator/` re-includes the plugin's files, so rules such as `lib/` or `bin/` in your project cannot leave them out.
- On initialization and on every invocation, the skill checks the plugin's files against all of Git's ignore rules (the project's `.gitignore` files at every level, plus the machine-local and global excludes). If a rule ignores `.navigator/` as a whole, or the configuration under `.claude/`, the skill stops and names the rule, so you can change it before continuing.
- After each work order is committed, any file under `.navigator/` or in the plugin-managed configuration that is still uncommitted is listed, and the work order is complete only after a follow-up commit.

## Roles

| Role                 | Who                                                 | What it does                                                                                              |
| -------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Orchestrator session | The session that invokes the skill                  | Plans, records, writes work orders, organizes reviews, runs checkups; writes only under `.navigator/`     |
| Executor session     | A new session where you paste the launch prompt     | Researches, selects, codes, and tests for one work order, then writes a receipt; never commits or pushes  |
| Reviewer subagent    | Dispatched by the orchestrator with a fresh context | Checks each criterion using only the tests and evidence tools you authorized, reports evidence; read-only |
| Researcher subagent  | Dispatched by the orchestrator during framing       | Researches the problem domain: similar products, users, industry practice, constraints; read-only         |
| You                  | The only decision maker                             | Every decision, test authorization, hands-on acceptance, and how to commit                                |

The project's hooks enforce these boundaries. For example, the orchestrator is blocked from writing business code, and an executor is blocked from editing files before you approve its plan. Each denial explains why.

## Stages

| No. | Stage     | What happens                                                                                                                                                          |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Survey    | Existing projects only: read the repository, run a build and test check, write a status report                                                                        |
| 1   | Framing   | Understand the requirement, research the problem domain, report, Socratic brainstorming, project brief                                                                |
| 2   | Main flow | Write the shortest path through the core scenario, split it into milestones and slices, register risks                                                                |
| 3   | Selection | Compare engineering standards and pick the comment language; executors select technologies with source proof, which the review fetches from the original repositories |
| 4   | Skeleton  | The first slice: the smallest version that runs the main flow end to end                                                                                              |
| 5   | Slices    | Deliver slice by slice, with a review at the end of each milestone                                                                                                    |
| 6   | Closing   | Overall acceptance against the brief, statistics, and a retrospective                                                                                                 |

A requirement change can come in at any stage and returns to the same position afterwards. Skipping a stage requires your explicit approval and a written reason.

## Round trip of a work order

1. **Issue.** The orchestrator writes the work order and replies with "工单发布", which contains a launch prompt. After you choose A, the orchestrator replies with "等待回执" (awaiting receipt), showing where the work order and the receipt are, and waits for the executor to finish.
2. **Start.** Open a new Claude Code session in the project root and paste the launch prompt. The executor reads the executor guide and the work order, checks the commit and the premises, makes a plan, and replies with "开工对齐". Its "模块划分" (module plan) section lists the modules to create and change, and what changes in the entry file; read it before you choose A. It can edit business files only after you choose A.
3. **Report.** When done or blocked, the executor replies with "执行完成" or "执行受阻", and you choose how to report:
   - A. Document report: the executor writes the receipt file; go back to the orchestrator and choose A in "等待回执". If the receipt is not there yet, the orchestrator replies with "等待回执" again and says the receipt was not found.
   - B. Message report: the executor sends the receipt straight to the orchestrator. Both sessions must be open.
4. **Review.** The orchestrator sends the reviewer subagent to check each criterion, with one of three verdicts: 通过 (pass), 不通过 (fail), or 未验证 (unverified). Only when every criterion passes does it ask you to verify by hand; any failed or unverified criterion fails the work order directly, and you are never asked to fill the gap by hand. Tests that need real accounts or have external effects run only after you agree; see [Test authorization and evidence tools](#test-authorization-and-evidence-tools) below.
5. **Commit.** After acceptance, choose to commit only, commit and push, or hand over to [`commit-message`](commit-message.en.md). The business changes and the records of the round go into one commit. If there are changes outside the receipt (for example, editor project files), the orchestrator lists them and asks whether to include them.

Work orders run strictly one at a time. If the same slice fails review twice in a row, the orchestrator suggests splitting it smaller.

Every work order that changes code carries a fixed criterion, "代码检查通过" (code checks pass). The check commands are chosen during selection, using each language's established check tools with function length and complexity rules enabled, and they do not check `.navigator/` or `.claude/`. If the checks fail, the work order cannot pass review.

A selection receipt lists its source evidence in a table: capability, repository, version, path, lines, and note. The reviewer subagent runs the `evidence` command, which fetches those lines from the original repository at that version, and checks them one by one without relying on the executor's copy. When a selection order fails, the orchestrator opens a new selection order to correct it.

### Test authorization and evidence tools

Some criteria can be confirmed only through an external tool or a real environment, for example a flow driven by a server-side state machine that can only be compared against captured traffic. When a receipt contains such tests, the orchestrator first replies with "测试授权" (test authorization), and you choose:

- **A. Authorize.** Registered test commands are run by the reviewer subagent itself. MCP tools (for example, the query tools of the Reqable capture tool) are registered by their full names as evidence tools, and the reviewer subagent uses the same tool to look again at the location given in the receipt's "取证记录" (evidence record). Only the reviewer subagent can call evidence tools, never the orchestrator, and the registration applies to later work orders too. Authorize read-only tools only; do not register tools that send requests or clear records.
- **B. Run it yourself.** Run the command, or look in the tool yourself, and paste the complete output as one message. The orchestrator writes the output unchanged into `user-tests.md` in the work order folder, the hook checks that it matches your pasted text word for word, and the reviewer subagent judges the criteria from that output. Hooks cannot see the output of commands run with `!`, so copy and paste it.

Either way, the reviewer subagent gives the verdict, and any unverified criterion still fails the work order.

## What replies look like

Every orchestrator reply has the same structure: a type heading, the current progress, a few fixed sections, one option block, and a closing summary of at most 80 characters. For example, a work order announcement:

````markdown
# 工单发布

## 当前进展

- 当前阶段: 5/6 (切片)
- 当前里程: 1/3 (导出报表)
- 当前切片: 2/4 (导出 CSV)
- 当前工单: 0007

## 工单概况

- 文件路径: .navigator/orders/0007-export-csv/order.md
- 任务目标: 在报表页点击 "导出" 后下载当月数据的 CSV 文件
- 判据数量: 0003
- 计划要求: 必须先计划

## 后续操作

在仓库根目录新开一个 Claude Code 会话, 粘贴下面的启动提示词.

```markdown
执行工单 0007.
(rest omitted)
```

```
[如何继续]

A. 已发工单, 等待回执.
B. 修改工单, 请提需求.
```

```text
<- ++++++++++ ->
工单 0007 已发布: 导出当月 CSV, 3 条判据. 请新开会话粘贴启动提示词.
```
````

You only need to reply with an option letter, adding details after it when needed.

## Records

```text
.navigator/
├── state.json          Progress, numbers, and statuses; changed only by the scripts
├── bin/                Runtime scripts and reference files copied by init
├── guide/executor.md   Executor guide
├── plan/               Brief, glossary, research, brainstorm, main flow, roadmap, risks, decisions, changes, reviews, checkups
└── orders/0007-export-csv/
    ├── order.md        Work order
    ├── receipt.md      Receipt
    ├── user-tests.md   Output of tests you ran yourself (only when you choose to run them)
    ├── artifacts/      Evidence files left by the executor, such as raw captures or reproduction scripts (only when needed)
    └── review.md       Review record
```

- `plan/roadmap.md` and `plan/risks.md` are generated from the state. Do not edit them by hand.
- `.navigator/drafts/` holds drafts the orchestrator uses to pass Chinese text to the scripts, and is not committed.
- `artifacts/` in a work order folder holds evidence files left by the executor, such as raw captures and reproduction scripts. The executor can write there only after you choose A; the files are committed with the work order whatever their type, and the reviewer subagent reads them by path. A script in it runs during review only after test authorization.
- Whenever the records change, the scripts back up `.navigator/` to the hidden Git ref `refs/navigator/snapshots`. The ref is not part of any branch history, and neither `git reset` nor `git checkout` removes it.

## Rollbacks and anomalies

On every invocation, the skill compares the recorded commit, the current commit, and the latest backup:

- You rolled back a commit, switched branches, or committed outside the workflow: it replies with "验收异常", and you choose to align the records with the repository, adopt the new commits, or survey again.
- You edited files under `.navigator/` by hand: you choose to keep the edits or restore the backup.
- After a squash merge, the records are unchanged, so the skill recognizes it and asks you to adopt it.

Until the anomaly is resolved, the orchestrator pauses other operations, so a new backup cannot hide the anomaly.

## Engineering standards

At the start of the selection stage, the orchestrator compares three sets of standards: the general engineering standards bundled with the plugin, the project's existing standards (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, formatter settings), and your machine's global standards. You decide each conflict, at most three at a time. The result is written to `.claude/rules/engineering.md`, which every session in the project loads automatically.

Code comments default to Chinese, and you can choose English or another language instead. Every "开工对齐" reply shows the comment language as a reminder.

## Checkups

Run `/waypoint:project-navigator check`, or let it run automatically at each milestone review. A checkup has two layers:

- Script checks: structure against the templates, overly long sentences and paragraphs, long or deeply nested lists, jargon, metaphors, translationese, and sentences that start with a bare "它" or "这是".
- Semantic checks: a reader subagent looks for invented abbreviations, undefined terms, unclear references, empty phrases, and more.

The results come as an issue list, and you decide whether to fix them one by one or just record them.

## FAQ

**Why did "help me plan a project" not trigger the skill?**

The skill runs only through `/waypoint:project-navigator`, so an ordinary conversation never starts the whole workflow by accident.

**Can the orchestrator write a bit of code for me?**

No. The hooks block the orchestrator from writing business code. When code needs to change, the orchestrator issues a work order for an executor session.

**Can I ask the orchestrator to install a dependency?**

No. Installing dependencies, building, and running business scripts are implementation work and are blocked as well.

**A criterion can be confirmed only with an MCP tool such as a traffic capture. How is it reviewed?**

The executor writes the tool and where to look in the receipt's "取证记录" (evidence record). Choose A in "测试授权" and register the read-only query tools as evidence tools, and the reviewer subagent looks for itself; choose B, and you look and paste the result. Do not clear the records in the tool before the review ends.

**I chose to commit only, but the orchestrator says it has no permission to commit?**

In the commit step, the hooks allow only a few fixed forms: `git add -- <paths...>`, `git commit -F -` with the message on standard input, and `git push` without force options. `-m` and `-F <file>` are denied, and the denial gives the allowed forms, so the orchestrator switches to one of them; you do not need to commit by hand.

**Can several work orders run in parallel?**

No. Work orders run strictly one at a time, so each one has a well-defined base commit and review result.

**How do I stop using it?**

Run `/waypoint:project-navigator uninstall`. The hooks and allow rules are removed, all records in `.navigator/` are kept, and you can initialize again later.

## Known limitations

- Every machine that works on the project needs Node.js 22 or later, or the guard hooks cannot run.
- In an initialized project, every tool call starts Node.js once more, which took about 70 milliseconds in local measurements.
- Writing requirements such as plain Chinese rely mainly on prompts and checkups. The script checks are approximations and can miss issues or flag false ones.
- A reply with a format problem is sent back for one rewrite, but the faulty version stays on the screen.
- File edits made through shell commands are checked only roughly, and the hooks do not restrict what you do in your own editor.
- Message reports require the orchestrator and executor sessions to be open at the same time on the same machine.
- Source evidence supports only public git repositories; a dependency without a public repository is marked unverified, and you decide whether to accept that risk.
- Evidence tools see the external tool's records as they are at review time. If the records were cleared before the review, or the tool is not running, the affected criteria are marked unverified.
- The last 20 messages the orchestrator received are kept on your machine in `.git/navigator/prompts.json` to check the test output you paste. They are not committed.
