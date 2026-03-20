# PLAN: Multi-Terminal + Sidebar (Phase 2)

## Goal

Expand kolu from one hardcoded PTY to dynamically created/killed terminals
with a sidebar for navigation and status indicators. All ghostty-web terminal
instances stay alive simultaneously; switching is via CSS visibility toggle for
instant, stateful switching. This is the "tmux replacement" moment.

## Constraints

- DashMap for terminal registry — no `Arc<Mutex>` for shared state
- Terminal IDs unique by rejection — no auto-numbering
- Plain functions on plain data — no manager/service objects
- ghostty-web interop stays in `ghostty-bridge.js` only
- One WS connection per terminal, persistent for its lifetime
- `nix build` + `nix run` must work when done
- e2e tests for all new features

## Decisions

| Decision | Choice | Rationale |
| :------- | :----- | :-------- |
| Terminal switching | CSS visibility toggle, all instances alive | Instant switching with preserved scroll/state. Memory negligible for <20 terminals. |
| WS architecture | One WS per terminal | Simpler code, no multiplexing protocol. Fine for single-user localhost. |
| Terminal registry | `DashMap<TerminalId, LiveTerminal>` | Concurrent shard-level locking. Status sweep iterates while handlers read. |
| Kill semantics | DELETE kills PTY + removes from registry | Simplest UX. Scrollback visible while alive; gone after kill. |
| Child handle storage | `Box<dyn Child + Send + Sync>` in LiveTerminal | `DashMap::get_mut()` gives `&mut` for `try_wait()` and `kill()`. No separate ChildKiller needed. |
| Status polling | Tokio task every 2s | Simple. Polls `try_wait()` + checks `last_output_at`. Accuracy within 2s is fine for indicators. |
| Startup | Auto-spawn default terminal | `id: "default"`, `label: "shell"`, command from `$SHELL`. User lands on a working shell. |

## Risks & Assumptions

| Risk / Assumption | Severity | Status | Mitigation / Evidence |
| :---------------- | :------- | :----- | :-------------------- |
| ghostty-web rendering artifacts after CSS show/hide | MEDIUM | Unvalidated | First deliverable tests this. Fallback: destroy/recreate (Approach A). |
| portable-pty `try_wait()` works for status polling | LOW | Validated | Delegates to `std::process::Child::try_wait()`. Reviewed source. |
| DashMap iteration doesn't block handlers | LOW | Validated | Shard-level locking. Single user, minimal contention. |
| Multiple ghostty-web instances coexist | MEDIUM | Partial | Source review confirms independent instances. In-browser validation pending. |

## Open Questions

- None. Research resolved ghostty-web switching and portable-pty child API.

## Scope

### In Scope

- Server: DashMap terminal registry, CRUD functions, status sweep, REST API
- Server: WS handler looks up terminal by ID
- Client: multiple terminal containers with CSS visibility toggle
- Client: sidebar with status dots, click to switch
- Client: new-session dialog (label + command)
- Client: auto-spawned default terminal on startup
- e2e tests for create, switch, kill, duplicate rejection

### Out of Scope

- Repo registry (Phase 3)
- Worktree integration / tree hierarchy sidebar (Phase 4)
- Session persistence across restarts (Phase 6)
- Keyboard shortcuts for tab switching (Phase 6)
- Multiplexed WebSocket
- LRU terminal eviction

## Phases

1. **Phase 2a: Server-side multi-terminal** — replace single PtyHandle with DashMap registry, CRUD API, status sweep
   - [ ] `common/src/lib.rs`: add `Terminal`, `TerminalId`, `TerminalStatus`, `CreateTerminalRequest` types
   - [ ] `server/src/terminal.rs`: `LiveTerminal` struct, `create`/`list`/`get`/`kill` functions, status sweep task
   - [ ] `server/src/state.rs`: `AppState` wraps `DashMap<TerminalId, LiveTerminal>`
   - [ ] `server/src/api.rs`: `POST /api/terminals`, `GET /api/terminals`, `DELETE /api/terminals/:id`
   - [ ] `server/src/ws.rs`: lookup terminal by ID in DashMap, return 404 if missing
   - [ ] `server/src/main.rs`: no hardcoded PTY spawn at startup; create default terminal via `terminal::create`; mount API routes
   - [ ] Existing e2e tests still pass (default terminal serves as before)

2. **Phase 2b: Client-side multi-terminal + sidebar** — sidebar UI, terminal switching, new-session dialog
   - [ ] `client/src/sidebar.rs`: flat terminal list with status dots (● Running, ○ Idle, ✕ Exited), click to switch, "+ new" button
   - [ ] `client/src/new_session.rs`: form (label + command, default `$SHELL`), POST to API, auto-select new terminal
   - [ ] `client/src/terminal_view.rs`: refactored for multiple instances — all containers in DOM, CSS visibility toggle, `fitToContainer()` on show
   - [ ] `client/src/app.rs`: sidebar (fixed 260px) + terminal pane (flex) layout
   - [ ] e2e tests: create 3 terminals, switch between them, kill one, verify status indicator, reject duplicate ID

## Verification

- [ ] `nix build` succeeds
- [ ] `nix run` starts server with default terminal, browser shows shell
- [ ] Create additional terminals via sidebar → each gets own PTY + WS
- [ ] Switch between terminals → instant, no scrollback replay, scroll position preserved
- [ ] Kill a terminal → disappears from sidebar, PTY process terminated
- [ ] Duplicate terminal ID → rejected with error
- [ ] `just test-dev` passes all e2e tests (existing + new)
- [ ] `just pc` passes

## Technical Debt

| Item | Severity | Why Introduced | Follow-Up | Resolved |
| :--- | :------- | :------------- | :-------- | :------: |

## Deviation Log

| Commit | Planned | Actual | Rationale |
| :----- | :------ | :----- | :-------- |

## Retrospective

### Process

- Did the plan hold up? Where did we diverge and why?
- Were the estimates realistic?
- Did CHALLENGE catch the risks that actually materialized?

### Outcomes

- What unexpected debt was introduced?
- What would we do differently next cycle?

### Pipeline Improvements

- Should any axiom/persona/workflow be updated based on this experience?

## References

- Sketch: `.sketches/2025-03-20-multi-terminal-sidebar.md`
- Parent plan: `docs/plans/000-KOLU.md` (Phase 2)
