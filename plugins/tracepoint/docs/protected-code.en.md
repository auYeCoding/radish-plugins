# protected-code

English | [简体中文](protected-code.md)

[Back to TracePoint](../README.en.md)

General methods for analyzing protected or obfuscated compiled code. Identify which class of protection it is first, then decide whether to go static or dynamic, instead of grinding statically against the protection. This skill gives general approaches only — no bypass steps for any specific product — and is honest about what the model can and cannot do.

## When it applies

When a target resists normal analysis, alongside [analyze](analyze.en.md):

- Packers or runtime-decrypted code; anti-debugging; self-modifying code.
- Control-flow flattening; opaque predicates; bogus control flow.
- A custom bytecode virtual machine (VM); decoys and misleading constructs.

## How it triggers

**Natural language:** e.g. "this program looks packed, how do I analyze it", "this control flow is flattened".

**Slash command:** `/tracepoint:protected-code`. It also joins in automatically when analysis stalls or looks obfuscated.

## Method in brief

1. **Identify the protection type first.** Three classes: hiding (packing, runtime decryption, self-modifying), complicating (control-flow flattening, opaque predicates, custom VM), misleading (decoys, fake symbols, fake success conditions). Misidentifying wastes a lot of static effort.
2. **Choose the path from the type.**
   - Hiding: go dynamic — dump the unpacked memory, patch out anti-debugging, let the target reveal its real code and state.
   - Complicating: extract the bytecode and decode it by its opcode table, or recover the control skeleton; for a custom VM, treat the dispatch loop as an interpreter — the real logic is in the data (the bytecode), so do not read the switch branches one by one as algorithm steps.
   - Misleading: check against ground truth from the environment, and do not get steered by fake symbols or decoys.
3. **State honestly what cannot be done.** Fully recovering a VM handler's semantics statically is generally hard for current models; when it cannot be done, say "a dynamic run is needed to be sure" instead of inventing equivalent logic.

## What the model can and cannot do

- **Can:** recognize the protection class and choose the right path; statically decode and recover the equivalent expression of a small bytecode VM; point out where a dynamic run is needed.
- **Often cannot:** fully de-virtualize a large or nested VM statically; fully recover under strong anti-analysis without a dynamic run. These cases should move to dynamic analysis or hand back honest partial results.

## Known limits

- General methods and reasoning only; no bypass steps for any specific packer or anti-cheat product.
- Dynamic techniques (debuggers, instrumentation, dumping) need the corresponding tools connected and must be run on a target you are authorized to analyze.
