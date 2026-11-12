# project-navigator

English | [简体中文](project-navigator.md)

[Back to WayPoint](../README.en.md)

Guides a large project from a single high-level idea through problem-domain research, framing, technology selection, and a minimal runnable skeleton, then moves it forward in vertical slices and milestones, handling changes in requirements or direction along the way.

The session that invokes this skill only plans, records, issues work orders, and organizes reviews. It is called the orchestrator session. Writing code, building, and testing are done by executor subagents the orchestrator dispatches in the background, and reviews are done by a reviewer subagent with a fresh context. Every step is recorded in the repository, so any new session can pick up where the last one left off.

The skill's replies and records are written in Simplified Chinese.

## When to use it

- Starting a project that will take weeks or longer, when you want the problem, scope, and main flow clear before writing code.
- Moving an existing project forward, with a clear goal, acceptance criteria, and review for every change.
- Handling a change in requirements mid-project, by assessing its impact and adjusting the plan.

It is not meant for small tasks such as fixing a typo, patching a small bug, or writing a one-off script. Just ask Claude directly for those.

## Requirements

- [Git](https://git-scm.com): the project must be a Git repository. If it is not a repository yet, run [`/waypoint:repo-init`](repo-init.en.md) first.
- [Node.js](https://nodejs.org) 22 or later: the hooks and commands run on Node.js.
- Start Claude Code in the project root.
- During selection, the public git repositories (https) of the chosen dependencies must be reachable: the review fetches source code from the original repositories to verify the evidence.

## Invocation

The skill runs only when you invoke it explicitly. Plain-language requests never trigger it:

```text
/waypoint:project-navigator [init | check | uninstall | initial idea]
```

- No argument: show the current progress and continue as prompted.
- `init`: initialize the project, or upgrade a project initialized by an older version.
- `check`: run a checkup on the record documents.
- `uninstall`: stop using the skill in this project, keeping all records.
- Any other text: used as the initial idea, for example `/waypoint:project-navigator build a tool that collects the team's weekly reports`.

Any session that invokes the skill continues from the recorded state; there is nothing to take over or register. After you rewind or edit a message in the desktop app, the session simply continues.

## Quick start

Take "build a tool that collects the team's weekly reports" as an example, starting from a new repository that has only a README. Each reply starts with a one-line conclusion and ends with an option block, so you only need to answer with a letter. In the Claude desktop app, a reply with two choices also shows two buttons above the input box, and a click answers with that choice. To add details, write them after the letter, for example `B assumption 3 is wrong, we use Feishu`.

### First invocation

1. Start Claude Code in the project root and enter `/waypoint:project-navigator build a tool that collects the team's weekly reports`.
2. The skill replies with "初始设置" (initial setup), listing the check results and what it will write. Answer `A`.
3. The skill initializes, commits the written files through [`commit-message`](commit-message.en.md), and replies with "首次接入" (first entry). Answer `A` for a new project, or `B` for a project with existing code.

### Framing and main flow

1. "需求理解" (requirement understanding) lists your own words and the skill's assumptions separately. Answer `B` with the numbers of any wrong assumptions, or `A` if they are right.
2. The skill sends a research subagent to look at similar products, target users, industry practice, and constraints, then replies with "调研报告" (research report). Research needs web access and usually takes a few minutes.
3. Choose `A` to brainstorm the problem, users, and scope together, or `B` when you already know what you want or the project is small: the skill then drafts the brief from the research for you to correct.
4. The skill writes the project brief and replies with "产出确认" (output confirmation). The main flow and the roadmap are confirmed the same way.
5. When a new stage starts and records from the previous stage are not committed yet, the skill commits them through commit-message; other changes are listed for you to decide.

### Selection and the first work order

1. "规范对照" (standards comparison) lists conflicting engineering standards for you to decide one by one, then asks for the language of code comments.
2. The skill may recommend technologies from the research; key dependencies such as the language, framework, and core libraries are verified with selection work orders.
3. When a work order is written, the skill replies with "工单审阅" (work order review): the goal in one sentence, the decisions it needs from you, what is out of scope, and why the order has this size. Answer `A` if it is right, or `B` with the changes you want. The full order is at the path shown under the review points.
4. After you answer `A`, the skill dispatches an executor subagent in the background and replies with "工单执行" (order running). You can do something else; the orchestrator continues on its own when the executor finishes.
5. When the executor is blocked (for example, the specification contradicts itself, or it needs a choice between approaches), the skill replies with "受阻处理" (blocked handling) for you to decide; the executor then continues. When it only needs you to do something by hand, the skill replies with "等待操作" (waiting for your action), and you reply "操作完成" (done) afterwards.
6. When the work is done, the skill sends the reviewer subagent and replies with "验收报告" (review report). If everything passes, choose `A` to commit, `B` to commit and push, or `C` if you found a problem. For a selection order, you decide whether to adopt the result or choose another option.

The skeleton and every later slice follow the same work order round trip. Normally a work order needs two decisions from you: publish it at review, and accept and commit it after the review.

### Coming back later

Open a new session in the project root and enter `/waypoint:project-navigator` without an argument. The skill replies with "恢复进度" (resume progress), stating where it stopped and what comes next.

## Initialization

On the first invocation, the skill checks the environment and asks whether to set up. After you choose A, it:

1. Creates the state directory `.navigator/`: the state file, the glossary, and the plan and order directories.
2. Adds permission rules for the plugin command and for writing records to `.claude/settings.json`, keeping your existing settings. A copy of the permission rules goes into the local `.claude/settings.local.json`, which is not committed.

The hooks come from the plugin and are not written into project settings; in projects that are not initialized, the plugin's hooks do nothing.

Both `.navigator/` and `.claude/settings.json` must be under version control, so the records survive switching machines or rolling back. The `.gitignore` inside `.navigator/` re-includes the record files; at initialization and on every invocation, the skill checks the record files against all of Git's ignore rules, and if a rule ignores `.navigator/` entirely or the configuration under `.claude/`, it stops and names the rule.

### Upgrading from 0.x

1.0.0 changes a lot, so a project initialized by 0.x needs one upgrade. After updating the plugin, invoke the skill: it reports that the project was initialized by an older version and replies with "初始设置" (initial setup). After you choose A, it:

- Removes the old project-level hooks and old permission rules from `.claude/settings.json` and writes the new permission rules.
- Deletes the copies under `.navigator/bin/` and `.navigator/guide/`, and removes old session registrations and snapshot records from the local `.git/navigator/`.
- Moves an issued work order without a receipt back to drafting, so it is reviewed again and then handled by an executor subagent.

All records are kept. The upgrade is committed through commit-message.

## Roles

| Role              | Who                                              | What it does                                                                                   |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Orchestrator      | The session that invokes the skill               | Plans, records, writes work orders, organizes reviews and checkups; writes only `.navigator/`  |
| Checker subagent  | Sent by the orchestrator before the order review | Checks that each fact written in the order holds and each criterion can be verified; read-only |
| Executor subagent | Dispatched by the orchestrator in the background | Writes code, tests, and the receipt for one work order; never commits or pushes                |
| Reviewer subagent | Sent by the orchestrator, with a fresh context   | Checks each criterion, runs the code checks and tests, returns evidence; read-only             |
| Research subagent | Sent by the orchestrator during framing          | Researches the problem domain: similar products, users, practice, constraints; read-only       |
| You               | The only decision maker                          | Every decision: publishing orders, handling blocks, accepting reviews, how to commit           |

The hooks guard only a few boundaries: the orchestrator cannot write files outside `.navigator/`; the state file and the generated views can only be changed by plugin commands; under `.navigator/` the executor can write only its order's receipt and evidence files, and on run-check and analysis orders it cannot change business files; the checker and the reviewer cannot write files. Everything else is left to the skill's rules and is not blocked.

### Which model each subagent uses

The model of a subagent is set when it is dispatched. The defaults are below; `project-navigator model` shows the current assignment:

| Subagent                              | Default model            | Why                                                                          |
| ------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| Executor                              | Follows the orchestrator | It designs and decides, and it is the one that points out a wrong work order |
| Checker, reviewer, reader, researcher | Sonnet                   | They gather evidence against a list and need no design judgement             |

To change it, tell the orchestrator or run the command yourself. A model is `sonnet`, `opus`, `haiku`, `fable`, or `inherit` (follow the orchestrator):

```bash
project-navigator model set reviewer inherit
```

The executor can be set per order kind, for example Sonnet for fix orders only:

```bash
project-navigator model set executor sonnet --kind fix
```

Before moving implementation orders to a smaller model, look at how often recent orders were blocked or rejected: one round of rework makes the orchestrator read the receipt again, change the order, and dispatch again, which can cancel the saving.

### Permission prompts

When the executor writes files in the background in the default permission mode, the write prompts appear in the orchestrator session. A work order often writes many files, so you may switch the session to "Accept edits" while an order runs to avoid repeated prompts. That is your choice.

## Stages

| No. | Stage     | What happens                                                                                                                                                                       |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Survey    | Existing projects only: read the repository, run checks, write a status report                                                                                                     |
| 1   | Framing   | Requirement understanding, problem-domain research, research report, brainstorming (optional), brief                                                                               |
| 2   | Main flow | Write the shortest path through the core scenario, split it into milestones and slices, record risks                                                                               |
| 3   | Selection | Compare engineering standards, choose the comment language; for key dependencies the executor answers per requirement whether the library can do it, with source evidence or tests |
| 4   | Skeleton  | The first slice: the smallest version that runs the main flow end to end                                                                                                           |
| 5   | Slices    | Move forward slice by slice, with a review at the end of each milestone                                                                                                            |
| 6   | Closing   | Overall acceptance against the brief, statistics, and a retrospective                                                                                                              |

A requirement change can be inserted at any stage, and the work returns to where it was afterwards. Skipping a stage requires your explicit approval and a written reason.

## One work order round trip

1. **Precheck.** After writing the work order, the orchestrator sends a checker subagent to check the facts in it one by one: file paths, ids in the data, the release form and license of external resources, and whether each criterion can be verified. The orchestrator corrects what does not hold and puts trade-offs that need you under "需要决定" (decisions needed) in the review points. This step needs nothing from you.
2. **Review.** The orchestrator replies with "工单审阅" (work order review), listing only the review points and the order file path. The order can be issued only after you choose A; if the order changes after that, it is reviewed again.
3. **Execution.** The orchestrator dispatches an executor subagent in the background and replies with "工单执行" (order running). The executor checks the commit and assumptions, plans, implements, checks itself, and writes the receipt. "工单执行" needs no choice from you, so it has no option block; to stop and change the order midway, reply "停止执行" (stop).
4. **Waiting for your action.** When the order is fine and the executor only needs you to do something by hand (for example, one action in the program being debugged), it writes no receipt and hands back midway; the orchestrator replies with "等待操作" (waiting for your action) and lists the steps. Reply "操作完成" (done) with what you actually did, and the executor continues. This can repeat; the order status does not change.
5. **Blocked.** When the executor hits a specification problem, or needs a decision from you, it explains in the receipt and stops. The orchestrator replies with "受阻处理" (blocked handling); once you have handled it and the order does not need to change, the same executor continues without a new review. When only a few criteria cannot be met as written and the rest is unaffected, this is not blocked: the executor finishes the rest and lists those criteria as pending in the receipt, for you to decide at acceptance.
6. **Review of the work.** The orchestrator sends the reviewer subagent to check each criterion; the only verdicts are pass, fail, and unverified. While the reviewer works in the background, the orchestrator first replies with "工单验收" (order under review, no option block), then with "验收报告" (review report) when the result is back; its recommendation goes only in the "处理建议" (recommendation) section. In "验收报告":
   - Everything passes: you may verify by hand following the "人工验收" (manual verification) steps, then choose to commit, or commit and push.
   - Something fails: the orchestrator first judges why; an order that was too large is split, otherwise a fix order follows.
   - Only unverified criteria remain: you decide to accept as is and commit, or to follow up; accepted unverified criteria are recorded as risks. Criteria the receipt lists as pending are handled here too; "处理建议" (recommendation) states the facts and the options for each.
7. **Commit.** After acceptance, the orchestrator calls commit-message, and the business changes and records of the round become one commit. Changes outside the receipt are listed for you to decide.

Work orders run strictly one after another. The orchestrator sizes each order by four limits (one executor run can finish it, one review can check it, it runs afterwards, risky parts are separate), one slice per order by default, and states the reason in the review points.

Run-check and analysis orders only produce records: a run-check builds, runs, and tests with the existing commands and records the results; an analysis order covers hands-on investigation such as reverse engineering or research, producing documents and evidence scripts. Their executors can write only the receipt and the order folder's `artifacts/`; they need no check commands and can be issued before selection. A rejected one is followed by a new order of the same kind.

Every work order that changes code carries a fixed criterion, "代码检查通过" (code checks pass). The check commands are chosen during selection, using mature checkers for the language with function length and complexity rules enabled, and exclude `.navigator/` and `.claude/`.

Tests that need real accounts, cost money, or have external side effects are not run by the executor; it lists them under "外部影响" (external effects) in the receipt, and the reviewer judges from the output in the receipt instead of rerunning them. When a criterion can only be confirmed with an MCP tool such as a packet capture tool, the executor names the tool and where to look in the receipt, and the reviewer makes read-only queries with the same tool.

A selection answers one question: can the chosen library do each requirement listed in the order. The receipt has one row per requirement, with "能" (yes) or "不能" (no), backed by the library's source (repository, version, path, lines), or by a temporary test when the source does not show it. The reviewer runs `evidence` to fetch the source from the original repository at that version. You decide whether to adopt the result; requirements that did not check out are recorded as risks.

## What a reply looks like

Every reply from the orchestrator has the same structure: a type heading, a one-line conclusion, a progress line, a few sections, and an option block at the end (a reply that needs no choice from you, such as "工单执行", has no option block). For example:

````markdown
# 工单审阅

结论: 工单 0007 补齐 HTTP/2 指纹, 需要你决定是否在仓库内维护 fhttp 补丁.

阶段 5/6 (切片) · 里程 3/5 (引擎跑通主线) · 切片 4/10 (HTTP/2 指纹) · 工单 0007 (起草中)

## 审阅要点

- 任务目标: 调用方用指纹配置控制 HTTP/2 层的全部维度
- 需要决定: 在仓库内维护 fhttp v0.7.3 的补丁, 实现伪头不索引
- 明确不做: HTTP/1.1 与头部大小写, 留给切片 0005
- 粒度依据: 整个切片一张工单, 改动集中在适配层与补丁
- 工单文件: .navigator/orders/0007-http2-fingerprint/order.md

```
[是否发布]

A. 发布工单, 开始执行.
B. 需要修改, 请提需求.
```
````

The conclusion line alone tells you what is asked of you; the details follow for when you need them. The parentheses at the end of the progress line show where the work order stands (起草中 drafting, 执行中 running, 待你操作 awaiting your action, 受阻 blocked, 验收中 under review, 待你决定 awaiting your decision), which tells consecutive replies apart.

## Record files

```text
.navigator/
├── state.json          progress, numbers, and status; changed only by plugin commands
├── plan/               brief, glossary, research, brainstorming, main flow, roadmap, risks, decisions, changes, reviews, checkups
└── orders/0007-export-csv/
    ├── order.md        the work order
    ├── receipt.md      the receipt
    ├── artifacts/      evidence files left by the executor, such as raw captures and reproduction scripts (only when needed)
    └── review.md       the review record
```

- `plan/roadmap.md` and `plan/risks.md` are generated from the state by plugin commands. Do not edit them by hand.
- `.navigator/drafts/` holds drafts the orchestrator uses to pass Chinese text to commands. It is not committed.
- Your choices in work order reviews are registered in the local `.git/navigator/`, which is not committed.
- All records are in Git. If you roll back or edit the records, the skill continues from the current records; when they do not match reality, it says so and asks you which side to trust.

## Engineering standards

At the start of selection, the orchestrator compares three sets of standards: the general engineering standards bundled with the plugin, the project's existing standards (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, formatter configuration), and your global standards on this machine. You decide each conflict, at most 3 per round. The result is written to `.claude/rules/engineering.md`, which every session in the project loads automatically. Code comments default to Chinese; you can choose English or another language.

## Checkup

Run `/waypoint:project-navigator check`, or let it run automatically at each milestone review. A checkup has two layers:

- Script checks: whether the structure matches the templates, whether sentences and paragraphs are too long, whether lists are too long or too deep, and whether there is jargon, metaphor, translationese, or a sentence starting with a bare "它" or "这是".
- Semantic checks: a reader subagent looks for made-up abbreviations, undefined terms, unclear references, empty phrases, and so on.

The result is a list of problems, and you decide whether to fix them one by one or only record them.

## FAQ

**Why didn't "help me plan a project" trigger the skill?**

The skill runs only when invoked explicitly with `/waypoint:project-navigator`, so a whole workflow never starts by accident in an ordinary conversation.

**Can the orchestrator write some code for me?**

No. Writes outside `.navigator/` by the orchestrator are denied. When code needs to change, the orchestrator issues a work order and an executor subagent does it.

**Can I keep talking to the orchestrator while the executor works?**

Yes. The executor runs in the background, so you can ask questions or do other things; the orchestrator is notified and continues when the executor finishes.

**What happens to the executor's work if I close the orchestrator session?**

The executor belongs to the session that started it. When a new session invokes the skill, a written receipt is reviewed as usual; without one, the orchestrator dispatches a new executor.

**What if the skill itself misbehaves?**

The scripts notice some problems on their own: internal errors in a command or hook, an inconsistent state, a command that the "下一动作" (next action) asked for but that was refused, and the same next action given repeatedly while the state does not change. The orchestrator also reports when it finds rules that contradict each other. It then replies with "问题报告" (problem report): the report is written to `.navigator/drafts/reports/` (not committed) and shown in full in one code block, ready to copy to the plugin's maintainers. The report states only what happened: environment, a state summary, the recorded anomalies, and the course of events. It contains no guesses about causes, no advice, no work order text or business code, and local paths are masked. If the workflow can continue, choose `A`; if it cannot (an internal command error or an inconsistent state), orchestration pauses until the problem is fixed.

**Can the orchestrator write something outside the workflow?**

Yes. Just ask. The orchestrator replies with "自由答复" (free answer) and writes it in "答复内容" (answer) in the format you ask for, code blocks included. Choose `A` afterwards to return to the workflow.

**Can several work orders run in parallel?**

No. Work orders run strictly one after another, so each order's base commit and review result are well defined.

**How do I stop using the skill?**

Run `/waypoint:project-navigator uninstall`. The permission rules are removed, the plugin's hooks stop acting in this project, and all records in `.navigator/` are kept, so you can initialize again later.

## Known limitations

- Every machine that works on the project needs Node.js 22 or later.
- The plugin's hooks fire in every project, starting Node.js once for each write tool call and each message; in projects that are not initialized the script exits at once, about 70 ms on a local measurement.
- The guard checks only the target paths of write tools, not shell commands: if the orchestrator changes code or installs dependencies from the command line, only the skill's rules stop it.
- Writing requirements such as plain Chinese rely mainly on prompts and checkups, and replies are not sent back for writing rules; the script checks are approximate.
- A reply with a broken structure is sent back for one rewrite, but the broken version stays on screen.
- The executor cannot ask you questions while it works; anything that needs your decision ends the run as blocked and is handled afterwards.
- Source evidence supports only public git repositories; a dependency without one is judged unverified, and you decide whether to accept the risk.
- MCP evidence tools see what the external tool recorded at the time. If the records are cleared before the review, or the tool is not running, the related criteria are judged unverified.
