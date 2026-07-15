---
description: The Dock's agent-state folds — ONE fenced source of truth in @kolu/terminal-vocab; never re-derive, never collapse the order≠colour split
applyTo: "{packages/terminal-vocab/src/agentProjection.ts,packages/client/src/canvas/**}"
---

## The Dock's agent-state folds

kolu's on-canvas **Dock** (`packages/client/src/canvas/dock`) renders agent state through fenced folds that live **once** in **`@kolu/terminal-vocab/agentProjection`**.

- **One source of truth.** The agent-state vocabulary — how `AgentInfo['state']` folds to a coarse class — lives **once** in `agentProjection`, as `state satisfies never`-fenced folds: `agentUrgency` (needs-you ranking), `agentPaintClass` (pip/glyph colour), `alertClass` (notify membership). **Never re-derive any of these** with a hand-rolled switch over the state literals — import the fold. A new state literal must force one decision, in the fenced fold, not silently route through a copy.

- **The order≠colour split is load-bearing — don't collapse it.** A just-finished `waiting` agent **RANKS** idle (`agentUrgency`) but **PAINTS** awaiting (`agentPaintClass`) — the lingering "it just finished" cue. Every surface keeps that decoupling: **sort** by urgency, **colour** the pip/glyph by paint. `awaiting_user` (genuinely blocked) is what floats to the top; `waiting` (the post-turn lull) does not.

- **The folds' home is settled — don't repatriate them.** They live in the shared `@kolu/terminal-vocab` package even though the Dock is today their only paint consumer. That is history, not misplacement: the browser fleet mirror (`pulam-web`) they once also served **died with the pulam world** (the W2.3 burial deleted every `pulam*` package), and `padi-tui` is deliberately *not* a paint mirror (a thin uncoloured `status`/`watch`/`wait`/`create` CLI — no needs-you sort, no paint classes, no alert). Judging a fold's home by *today's* consumer count and "tidying" it into a kolu-local module is churn, not structure — and if a fleet mirror ever returns, it consumes these same folds, and the old two-surface sync contract (git history of this file) revives with it.
