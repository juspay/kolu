---
title: Meta-Agent Planning-Mode Dispatcher
number: 0002
status: draft
author: Gupta-ujjwal14
created: 2026-05-10
---

# 0002 — Meta-Agent Planning-Mode Dispatcher

## Summary

A conversational layer over the kolu UI — voice or text — that surfaces what every active terminal is currently asking, lets the user reply into specific terminals through that single layer, and quiets itself the moment a terminal is focused. Active in planning and brainstorming only; the full terminal remains the right surface for implementation and review.

## Motivation

Treat this as field notes from one user juggling three projects in parallel.

The cost is not any single read or reply — it is the constant context reload. Look at terminal A, page back to remember what was happening, reply, switch to B, reload its state, reply, switch to C. Each switch evicts the higher-level thread the user was holding ("how do these three projects relate? am I making consistent calls across them?") and forces a rebuild from the terminal contents. With one project this overhead is invisible. With three, it dominates.

kolu already solves the hardest version of this problem: nudges and actionable-terminal indicators tell the user **which** terminal needs attention. What remains is the trip itself — entering the session to learn **what** it needs. That summarise step happens in the user's head, repeatedly. The proposal lifts it into a layer so the high-level thread can stay loaded.

The friction is most visible in *parallel brainstorming*: three Claude / opencode sessions exploring related design questions, each periodically asking a yes/no or for a quick steer. Today the only way to keep the conversation moving is to focus each terminal in turn, and the per-trip context-reload tax is the cost of admission. Outside that mode — single-project work, deep implementation, code review — the friction disappears, which is exactly why the scoping below is load-bearing.

## User-facing behavior

Two surfaces — read and write — sharing a single UI chrome (the conversational layer the user interacts with) but with distinct underlying mechanisms (see Implementation notes). The user experiences one place to glance and one place to dictate; the implementation behind that experience is two seams.

**Read side.** On demand, the meta-agent surfaces a unified picture of what every active terminal is currently asking. Example phrasing the user might hear or read back:

> Project A is waiting on a yes/no about the migration shape. Project B finished and wants you to verify the diff. Project C is mid-build with no input expected.

This does not replace the terminal indicators — it complements them. The indicator says *which*; the meta-agent answers *what*, without the user having to enter the session.

**Write side.** The user replies through the same conversational layer, and the meta-agent dispatches each reply into the right terminal:

> Tell A yes, codemod approach. Tell B I'll review in ten. Skip C.

The terminal still owns the conversation; the meta-agent is a router, not a parallel agent. Internally the write side decomposes into two seams along independent volatility axes — see Implementation notes.

**Voice and text as transports.** Brainstorming flows faster spoken than typed, and a verbal interface meets the user where they already are when thinking hard — pacing, looking away from the screen. Text remains available for situations where voice is inconvenient (open offices, noisy environments). Both are *client-side* transports: the server contract receives a plain instruction string and never knows whether it was typed or spoken (mirroring how `sendInput` for terminals works today). Speech-to-text, push-to-talk UX, and text-input widgets are client-only concerns and not part of this proposal's scope.

**Auto-quiet on terminal focus.** When the user focuses a specific terminal, the meta-agent stops surfacing summaries and stops accepting dispatches until refocused. Outside planning mode the full terminal context is the right surface; the meta-agent should disappear rather than compete for attention.

This rule assumes the meta-agent and the terminals share one window. The second-display layout variant (see Open questions) breaks the assumption: with the meta-agent on display A and a focused terminal on display B, "terminal focus" no longer signals "user has shifted attention away from the meta-agent." Whichever layout maintainers pick will need to re-derive the auto-quiet trigger; the rule as stated above is the single-window default.

## Prototype

Not yet attached. CONTRIBUTING notes that proposal+prototype is the strongest form, and a screen recording of the workflow this would replace — the user pacing while orchestrating three projects through a single interface — would communicate the value better than prose. Happy to add one if maintainers want it before accepting; flagging the gap explicitly rather than treating the proposal as complete.

## Implementation notes

The user has no opinion on the *how* in general, but the structural review surfaced a few directions worth recording so they don't get re-litigated:

- **Read side is a presentation surface, not a new layer.** It derives from the existing per-terminal metadata subscription that already publishes "what is this session asking" data (agent state, summary). No new streaming procedure or server-side classifier is needed; the unified ledger is a client-side render over data the subscription already delivers.
- **Write side is two independent seams, not one dispatcher.** The volatility axes are different and should be encapsulated separately:
  - *NL intent parser.* Takes one instruction string plus the list of currently-active terminals, returns structured `(terminalId, message)` pairs. Volatile along the algorithm axis (rule-based vs. LLM-backed vs. hybrid; provider choice; confidence handling).
  - *Per-CLI safe injection.* Given a `(terminalId, message)` pair, decides when and how to write into that terminal's PTY — including mid-tool-call arbitration. Volatile along the per-agent-CLI axis: each CLI has its own input protocol and its own definition of "safe to deliver right now". Note that *what counts as mid-tool-call* is itself per-CLI — Claude Code, opencode, Codex, and anyagent each surface "I'm busy" in different ways, so the arbitration policy can't be answered once and applied uniformly.

  Treating these as one dispatcher couples the two axes: changing the NL parser would force a touch on the injection logic, and vice versa. The proposal names them as separate seams so an implementer doesn't collapse them out of convenience.
- **The per-CLI injection seam belongs in `AgentProvider`, not a parallel adapter family.** `AgentProvider` already encapsulates per-CLI volatility (detection, state-watching) and is the seam every new agent CLI already has to implement. Adding a second `DispatchProvider`/`InjectionAdapter` family alongside it would double the blast radius of adding a new CLI without naming a different volatility axis. Extend `AgentProvider` with an optional injection capability (method signature is an implementation decision).

## Alternatives considered

**Status quo: rely on existing nudges.** The actionable-terminal indicators already point the user at the right session. This is sufficient when N=1 or the sessions are unrelated — the trip into a single terminal is cheap. With multiple parallel brainstorms, knowing *which* still requires *entering* the terminal to learn *what*, and the in-head summarise step dominates.

**Read-only meta layer (no write side).** A summary-on-demand surface without dispatch is cheaper to build and avoids the arbitration questions below. It also captures most of the perceived value. Rejected as the primary shape because the orchestration win — staying in the high-level thread instead of dropping into terminals to type replies — is what makes the feature pay rent. A read-only version is a reasonable phase-one if the write side proves contentious.

**Build it outside kolu as a separate desktop tool that reads kolu's WebSocket.** Possible, but duplicates UI state, loses access to kolu's focus model (so the auto-quiet behavior becomes guesswork), and forces the user to install and maintain a second tool to use one feature.

**General orchestration / "Claude over Claude".** Out — see Out of scope.

## Open questions

- **UI shape vs. kolu's existing layout.** Where does the meta-agent live? A panel inside the existing window, an overlay over the terminal grid / canvas, or a dedicated window that can sit on a second display while the user paces? Each has trade-offs against kolu's current per-folder and per-workspace model that maintainers are better placed to judge.
- **Mid-tool-call arbitration on the per-CLI injection seam.** Dispatching a natural-language instruction into a Claude / opencode session that is currently waiting for the user is straightforward. Dispatching while the agent is mid-tool-call is not. Does the injection seam queue, refuse, or interrupt? The right answer is per-CLI and lives inside the injection seam (see Implementation notes), not in the NL parser.
- **NL parser authoring strategy.** Inside the NL intent parser seam: deterministic templating, an LLM call, or hybrid? This is the parser's internal volatility — confined behind the seam, but the choice still has UX implications (latency, failure modes, confidence handling) worth deciding before scoping.

## Out of scope

This proposal deliberately does **not** address:

- Implementation- or review-mode summarisation. In those modes a summary is strictly worse than the full terminal — the details that would be lost are exactly the ones the user needs.
- Replacing direct terminal access. The meta-agent is additive; the terminal remains the canonical surface for any work past planning.
- Cross-machine federation. Single-host kolu only.
- Multi-user shared planning sessions. Single-user only.
- Persistence of planning conversations across kolu restarts. Could be a follow-up proposal once the basic shape lands; not required for the initial behavior.
- "Claude over Claude" / general agent orchestration. The planning-mode scoping is load-bearing; this is not a step toward a meta-agent that survives outside brainstorming.
