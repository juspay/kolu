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

### 3. oRPC over WebSocket

All server↔client communication uses [oRPC](https://orpc.dev/) over a
single WebSocket connection. Terminal I/O (attach, sendInput, resize) and
lifecycle (create, list, kill) are typed RPC procedures. Streaming uses
async generators (`eventIterator`). Inspired by coder/mux architecture.

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
├── common/           # Shared types + oRPC contract (Zod schemas)
├── server/           # Hono + oRPC + node-pty + @xterm/headless
├── client/           # SolidJS + ghostty-web + oRPC client + Tailwind
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

oRPC migration, multi-terminal support, sidebar with status indicators.
Prior art: [coder/mux](https://github.com/coder/mux) (ghostty-web + oRPC).

#### 2a: Migrate to oRPC (single terminal)

Replace raw WebSocket handling with oRPC procedures over single WS.
Same Phase 1 UX, new transport. Server starts empty; client auto-creates
one terminal on mount.

- oRPC router: `terminal.create`, `terminal.attach` (streaming),
  `terminal.sendInput`, `terminal.resize`
- Server: `RPCHandler` from `@orpc/server/ws` on `/rpc/ws`, HTTP handler
  on `/rpc/*` via Hono middleware
- Client: `RPCLink` from `@orpc/client/websocket` + `partysocket` for
  auto-reconnect
- Terminal registry: `Map<TerminalId, TerminalEntry>` (ready for N terminals)
- PTY-first resize: await server resize before frontend resize
- Fire-and-forget sendInput for low-latency keystrokes

#### 2a.1: @xterm/headless screen state serialization

Replace raw scrollback buffer with `@xterm/headless` + `@xterm/addon-serialize`.
Server maintains headless terminal per PTY. On attach, serialize screen
state (~4KB) instead of replaying raw buffer (~100KB). Race-free: subscribe
before capture.

#### 2b: Multi-terminal + sidebar (create + switch)

Sidebar with create button, terminal list, hide/show switching (not
mount/unmount — prevents TUI thrashing, preserves frontend scrollback).
Empty state tip when no terminals exist. `terminal.list` + `terminal.onExit`
procedures. Layout: Header → Sidebar + terminal area.

#### 2c: Kill + status indicators + polish

`terminal.kill` procedure. Status dots (green=running, red=exited).
Auto-switch on active terminal kill. Keyboard shortcut Ctrl/Cmd+Shift+T.
Full e2e coverage.

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
