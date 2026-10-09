# review

English | [简体中文](review.md)

[Back to TracePoint](../README.en.md)

Call it when you hit a problem: the agent first writes out, as facts, the problem it ran into in this session so you can verify it, and records it as a defect; it then aggregates all defect records, attributes the recurring ones, and leaves it to you to decide whether to iterate the skills. This skill only presents facts and suggestions; it **never changes a skill on its own** — that is your call.

## When it applies

- A result from `analyze` or `protected-code` was wrong, the agent got stuck, or following a rule did not work, and you want the agent to spell out what happened so you can check whether the skill is at fault.
- You want to see which of the recorded defects recur and are worth improving a skill or rule over.

## How it triggers

**Slash command only:** `/tracepoint:review`. This skill does not auto-trigger. You can add a note after the command to point at the incident, for example `/tracepoint:review it just analyzed the same function twice`.

Defect records come from two places: when you correct the agent, the plugin hook prompts it to append one to `.tracepoint/defects/` on the spot; when you call this skill, the agent records the problems of the current session. Both are fact-only (what it saw, which rule applied, what it did, how it turned out). The agent does not decide "rule's fault or mine" — that is unreliable; attribution is left to review time, done by a person against a fixed taxonomy.

## How it works

1. **Describe the problems of this session.** The agent looks back over the session and writes, for each problem: which skill and task, what it saw, which rule of the skill it followed (quoted), what it did, and how the result differs from what you expected. Facts only; anything it cannot recall is marked as such. If the session has no such problem, it says so.
2. **Record them as defects.** Each problem is saved as one JSON file under `.tracepoint/defects/`; problems of the same kind reuse the existing pattern key. When you point out that a description is inaccurate, the agent corrects it and updates the record.
3. **Aggregate.** Run `review-defects.mjs` (the skill prints the full command); it deduplicates and counts by pattern key, lists the facts of every record, and marks the patterns that reach the promotion threshold (default: recurs >= 3 times, across >= 2 tasks, within 30 days). The agent relays those facts to you, not just the counts.
4. **Attribute by the fixed taxonomy.** Pick one class per promoted pattern: rule gap / skill or hook did not trigger / rule was lost / rule is ambiguous / rule present but ignored / not something a skill can fix.
5. **Raise for your decision.** Give a suggested change per class (amend a rule, push it down into a hook/checker, or record it as a known limit); nothing changes until you approve.

## Known limits

- The description in step 1 comes from the agent looking back over the session and may miss or misremember things, which is why you verify it; details are lost more easily after the session is compacted, so call the skill soon after the problem.
- Patterns below threshold are shown as facts only and are not raised for a change, to avoid treating a one-off as a pattern; you can still discuss a change for a single problem when you ask for it.
- With no `.tracepoint/` case directory, none is created; the problem is described in the reply only and not saved.
- Handles only skills in TracePoint's own namespace; other plugins (such as WayPoint) review theirs with their own `/<plugin>:review`, without overlap.
- Changing a skill requires your approval; this skill never edits `SKILL.md` itself.
