---
paths:
  - "{packages/terminal-workspace/src/agentProjection.ts,packages/client/src/canvas/**,packages/pulam-web/**}"
---

## The Dock ⇄ fleet-mirror contract

kolu surfaces agent state in **two** places that are meant to read **identically**: the on-canvas **Dock** (`packages/client/src/canvas/dock`), and its fleet **mirror** — **`pulam-web`** (the browser dashboard). pulam-web exists to *mirror the Dock's agent-state UX* in the browser; it is not an independent design. Treat the two as one feature with two renderers.

(**`pulam-tui` is no longer a paint mirror.** It was reverted to a thin `status`/`watch`/`wait` CLI that renders an *uncoloured* awareness snapshot — no needs-you sort, no paint classes, no alert — so it carries none of the folds below. The rich, colour-coded fleet glance is pulam-web's; see `docs/atlas/src/content/atlas/pulam-tui.mdx`.)

- **One source of truth.** The agent-state vocabulary — how `AgentInfo['state']` folds to a coarse class — lives **once** in **`@kolu/terminal-workspace/agentProjection`**, as `state satisfies never`-fenced folds: `agentUrgency` (needs-you ranking), `agentPaintClass` (pip/glyph colour), `alertClass` (notify membership). **Never re-derive any of these** in the Dock or the mirror with a hand-rolled switch over the state literals — import the fold. A new state literal must force one decision, in the fenced fold, not silently route through a copy.

- **Keep both in sync.** When you change how the **Dock** treats an agent state — its rank, its pip paint, its alert — the change belongs in the shared fold, and the **mirror must move with it**: mirror it in `pulam-web` in the **same PR**, or file the deferred fill-in as a phase in `pulam-web.mdx` and say so explicitly. The reverse holds too — the mirror must not invent agent-state semantics the Dock doesn't have.

- **A fold the mirror hasn't adopted yet is a GAP, not "kolu-only."** If `agentProjection` exports a fold only the Dock consumes today (as `agentPaintClass`/`alertClass` once were), that is the mirror still being built up — **not** evidence the fold is misplaced or should leave the shared package. Don't "tidy" it back into a kolu-local module; fill the mirror in (or record the gap). Judging a fold's home by *today's* consumer count, rather than the two-surface contract, is the exact mistake to avoid.

- **The order≠colour split is load-bearing — don't collapse it.** A just-finished `waiting` agent **RANKS** idle (`agentUrgency`) but **PAINTS** awaiting (`agentPaintClass`) — the lingering "it just finished" cue. Every surface keeps that decoupling: **sort** by urgency, **colour** the pip/glyph by paint. `awaiting_user` (genuinely blocked) is what floats to the top; `waiting` (the post-turn lull) does not.
