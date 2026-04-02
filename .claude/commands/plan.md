---
description: Plan a task factually — research first, ask when unsure, keep it simple
---

# Plan Command

Respond to the user's prompt using Plan mode, grounded in thorough research rather than assumptions.

## Usage

```
/plan <prompt>
```

## Workflow

### 1. **Sync with Remote**

- Run `git fetch origin` and check if the current branch is behind. If so, `git pull --ff-only`.

### 2. **Enter Plan Mode**

- Use the `EnterPlanMode` tool before doing anything else.

### 3. **Research Thoroughly**

- Investigate the codebase, docs, and relevant context deeply.
- Use Explore subagents, Grep, Glob, Read — whatever it takes.
- **Parallelize**: Launch parallel subagents for independent research.
- **Never assume**. Read the code. Check the config. Verify the dependency.
- If external tools/libraries are involved, use WebSearch/WebFetch.

### 4. **Clarify Ambiguities**

- If anything is ambiguous, **ask immediately** using `AskUserQuestion`.
- Don't guess intent. Be liberal with questions.

### 5. **Draft a High-Level Plan**

- **High level**: what to do and why, not how to implement each step.
- No code snippets, no line-by-line changes.
- Focus on **architecture and approach** — the "shape" of the solution.
- **Prefer simplicity**: if two approaches exist and one is simpler, choose it.
- Include an **Architecture section**: affected modules, new abstractions, ripple effects.

### 6. **Split Non-Trivial Plans into Phases**

- **MVP first**: Phase 1 delivers the minimum viable version.
- Each phase must be **functionally self-sufficient** — system works end-to-end after each.
- Don't split by layer; split by feature slice.

### 7. **Simplicity Check (Hickey)**

- Evaluate the plan using the `hickey` skill (via Skill tool).
- For each phase: does this complect independent concerns? Simpler alternatives?
- Revise to eliminate accidental complexity before presenting.

### 8. **Present Plan for Feedback**

- Use `ExitPlanMode` to present the plan and solicit feedback.
- Include a brief **Simplicity assessment** section.

### 9. **Execute on Approval**

- Once approved, invoke `/do` via the Skill tool: `skill: "do"`.
- Pass the full plan context as args so `/do` has complete understanding.
- **Never implement manually** — the `/do` workflow handles branching, PR, CI, and quality gates.

## Principles

- **Facts over assumptions**: Every claim backed by something you read or verified.
- **Ask over guess**: When in doubt, ask. Silence is not consent to assume.
- **Simple over clever**: Prefer the boring, obvious solution.
- **High-level over detailed**: The plan is a map, not turn-by-turn directions.

ARGUMENTS: $ARGUMENTS
