# kolu — Implementation Plan

> A web-based terminal multiplexer organized around repos and branches.
> SolidJS + Hono + ghostty-web. Simple Made Easy.

---

## Principles

### 1. Simple, not easy

From Rich Hickey's "Simple Made Easy": simple means _not interleaved_.
Each module does one thing. Data flows through function arguments and
return values, not shared mutable state.

**Concretely:**

- Plain functions over classes. No "manager" or "service" objects.
- Discriminated unions for closed variant sets.
- Signals for reactive state (SolidJS). No global stores unless needed.

### 2. Data records, not objects

State is plain objects/interfaces. No getters, setters, or builder
patterns. Serialize with JSON. Clone freely.

### 3. WebSocket, not REST

PTY I/O is binary WebSocket frames. Control messages (resize, exit) are
JSON on the same socket. No REST API needed for terminal communication.

### 4. Files over databases

All persistence is JSON files. The data is small. JSON is inspectable
and debuggable.

### 5. Nix always

`nix build` and `nix run` must work at every phase boundary.

### 6. Reject, don't guess

Terminal IDs must be unique. Reject duplicates with an error. No silent
auto-numbering.

---

## Project Structure

pnpm workspace monorepo:

```
kolu/
├── flake.nix
├── justfile
├── pnpm-workspace.yaml
├── common/           # Shared types + WS protocol
├── server/           # Hono + node-pty
├── client/           # SolidJS + ghostty-web + Tailwind
└── tests/            # Cucumber + Playwright e2e
```

---

## Phases

### Phase 0: Hello World ✅

Workspace setup, SolidJS page served by Hono, Nix build, e2e smoke test.

### Phase 1: One terminal in the browser ✅

Single PTY via node-pty, binary WebSocket bridge, ghostty-web canvas
rendering, resize handling, scrollback replay.

### Phase 2: Multiple plain terminals + sidebar

Create, list, switch, kill terminals. Sidebar with status indicators.

### Phase 3: Repo registry

Register repos (name → clone URL → local path). Persisted as JSON.

### Phase 4: Worktrees + worktree terminals

Git worktrees for repos. Terminals inside worktrees. Three-level
sidebar tree (Repo → Worktree → Terminal). Tab bar for switching.

### Phase 5: Git status + activity polish

Surface git info (dirty count, ahead/behind). Refined activity indicators.

### Phase 6: UX polish

Keyboard shortcuts, error toasts, theme, collapsible sidebar, session
persistence.

---

## Future Milestones

Deferred. Do not build during Phases 0–6.

- Agent activity detection (parse prompts vs output heuristic)
- PTY detachment / survival across server restarts
- Split panes
- juspay/AI integration (agent variants, nix-agent-wire)
- Multi-user / team features
- Notifications (Slack, browser)
- Metrics (tokens, time-to-completion, CI pass rate)
- Auto-PR pipeline
