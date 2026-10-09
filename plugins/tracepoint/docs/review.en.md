# review

English | [简体中文](review.md)

[Back to TracePoint](../README.en.md)

Reviews the skill defects recorded while using TracePoint, attributes the recurring ones, and leaves it to you to decide whether to iterate the skills. This skill only presents facts and suggestions; it **never changes a skill on its own** — that is your call.

## When it applies

- You corrected `analyze` or `protected-code` results, the plugin hook prompted a defect record, and you want to review them periodically.
- You want to see which defects recur and are worth improving a skill or rule over.

## How it triggers

**Slash command only:** `/tracepoint:review`. This skill does not auto-trigger.

Where defects come from: when you correct it, the plugin hook prompts the agent to append a fact-only record to `.tracepoint/defects/` (what it saw, which rule applied, what it did, how it turned out). The agent does not decide "rule's fault or mine" — that is unreliable; attribution is left to review time, done by a person against a fixed taxonomy.

## How it works

1. **Aggregate.** Run `review-defects.mjs` (the skill prints the full command); it deduplicates and counts by pattern key and lists the patterns that reach the promotion threshold (default: recurs >= 3 times, across >= 2 tasks, within 30 days). Patterns below threshold are not raised.
2. **Read the records.** For each promoted pattern, read the originals under `.tracepoint/defects/` to see the facts.
3. **Attribute by the fixed taxonomy.** Pick one class per pattern: rule gap / skill or hook did not trigger / rule was lost / rule is ambiguous / rule present but ignored / not something a skill can fix.
4. **Raise for your decision.** Give a suggested change per class (amend a rule, push it down into a hook/checker, or record it as a known limit); nothing changes until you approve.

## Known limits

- Patterns below threshold are not raised, to avoid treating a one-off as a pattern; they keep accumulating.
- Handles only skills in TracePoint's own namespace; other plugins (such as WayPoint) review theirs with their own `/<plugin>:review`, without overlap.
- Changing a skill requires your approval; this skill never edits `SKILL.md` itself.
