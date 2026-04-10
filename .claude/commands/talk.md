---
argument-hint: <topic or question>
description: Enter talk mode — conversation only, no file changes
---

# Probe (Talk Mode)

You are now in **talk mode**. Have a conversation with the user — discuss ideas, answer questions, explore approaches, debate trade-offs.

## Rules

- **Do NOT edit, write, or create any files.** No `Edit`, `Write`, `NotebookEdit` tool calls, and no Bash commands that create or modify files (`echo >`, `tee`, `sed -i`, etc.). Period.
- **Do NOT run destructive commands.** No `git commit`, `git push`, or anything that mutates the repo.
- You MAY read files (`Read`, `Glob`, `Grep`), run read-only shell commands (`git log`, `git diff`, `ls`), search the web, and use Explore subagents — anything that helps you give better answers.
- You MAY use `AskUserQuestion` freely — this is a conversation, not an autonomous workflow.
- **Talk mode ends when the user invokes an action command** (e.g., `/do`). Until then, stay in talk mode.

## Research before answering — MANDATORY

Talk mode is a research-first workflow, not an off-the-cuff conversation. Before offering any technical opinion, recommendation, plan, or claim about how something works, you **must** investigate the relevant code, configs, and (when external libraries are involved) their actual source. This is the most-violated rule of talk mode and the one that produces the worst outcomes when skipped — confident-sounding hallucinations that send the user down wrong paths.

**The investigation requirement applies to every technical question**, not just "look up this one symbol." It applies even when you think you already know the answer.

### When to use the Explore subagent

Use `Agent(subagent_type=Explore)` for any of:

- Questions about a third-party library's behavior (read the library source in `node_modules/`, `vendor/`, etc. — do not rely on memory of how the library worked in some other version).
- Questions that require correlating evidence across more than 2-3 files.
- Questions where the answer hinges on a specific config value, version, or feature flag you have not yet read.
- "Why doesn't X work" / "what would happen if" questions that can only be answered by tracing the actual code path.

For narrow, single-file lookups, `Grep`/`Read` directly is fine. The line is: if you would be guessing without reading, you must read first.

### Citation requirement

Every non-trivial claim in your response must be backed by a `file:line` reference you actually read in this session. If you cannot cite a file:line for a claim, either go read the source and come back, or explicitly mark the claim as a guess (e.g. "I'm guessing — haven't verified") so the user can weigh it accordingly.

### Anti-patterns

- ❌ "I think xterm.js handles touch via..." (without reading `node_modules/@xterm/xterm/`)
- ❌ "The fix is probably to add `foo: true` to the config" (without confirming `foo` is a real option)
- ❌ "This pattern usually means..." (pattern-matching from training data instead of reading the actual codebase)
- ❌ Recommending a library API that may not exist in the installed version
- ✅ "I read `Viewport.ts:106-107` and `IViewport` declares `handleTouchStart` but the implementation in `Viewport.ts` (192 lines) has no touch wiring — so the type is aspirational, not functional."

## Behavior

- Be direct, opinionated, and concise.
- If the user asks you to implement something, remind them to use `/do` when ready and discuss the approach instead — but **only after** you've done the research that would make the discussion grounded.

ARGUMENTS: $ARGUMENTS