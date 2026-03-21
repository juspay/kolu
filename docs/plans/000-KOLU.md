# kolu — Implementation Plan

> கோலு — the Navaratri tradition of arranging figures on tiered steps.
> Repos, worktrees, terminals — displayed in tiers.
>
> A web-based terminal multiplexer organized around repos and branches.
> Full-stack Rust (Leptos + Axum). Simple Made Easy.

---

## Principles

These are constraints for every phase. Claude Code should be reminded of
them at the start of each phase.

### 1. Simple, not easy

From Rich Hickey's "Simple Made Easy": simple means _not interleaved_.
Each module does one thing. Modules don't reach into each other's internals.
Data flows through function arguments and return values, not through shared
mutable state or trait-object indirection.

**Concretely:**

- No trait objects (`Box<dyn ...>`) unless genuinely needed for polymorphism.
  Prefer enums for closed sets of variants.
- No `Arc<Mutex<...>>` for shared state. Use `DashMap` or message passing
  via channels.
- No "manager" or "service" objects. A module is a collection of plain
  functions operating on data.
- No `impl` blocks with more than ~5 methods. If a struct needs many methods,
  the struct is doing too much — split it.

### 2. Data records, not objects

State is represented as plain `struct`s with public fields. No getters,
no setters, no builder pattern. Serialize with `serde`. Clone freely.

### 3. Channels, not callbacks

PTY output flows through `tokio::sync::broadcast`. WebSocket clients
subscribe. No callback registration, no observer pattern.

### 4. Thin JS interop

ghostty-web is a JS library. The Rust/WASM side mounts a `<div>`, then
hands off to JS via a small `wasm-bindgen` bridge. The bridge is a single
file (`ghostty-bridge.js`) that owns the ghostty-web lifecycle. Leptos
components call into it, but never import ghostty-web types.

### 5. Files over databases

All persistence is JSON files. No SQLite, no embedded DB. The data is
small (dozens of sessions, a handful of repos). JSON is inspectable,
editable, and trivially debuggable.

### 6. Nix always

`nix build` and `nix run` must work at every phase boundary. Nix handles
all dependencies: Rust toolchain, ghostty-web WASM bundle, Playwright for
tests. No CDN — all assets bundled via Nix derivations.

### 7. Reject, don't guess

Terminal IDs must be unique. If a user tries to create a terminal with a
duplicate label within the same worktree, return an error. Don't silently
append counters. Explicit is better than clever.

---

## Project Structure

Three-crate Cargo workspace, following the pattern from the Leptos
prototype rewrite:

```
kolu/
├── Cargo.toml               # workspace: members = ["client", "server", "common"]
├── Cargo.lock
├── flake.nix                 # Nix: builds client WASM + server binary + wrapper
├── flake.lock
├── justfile                  # Dev workflow recipes
├── rust-toolchain.toml       # Pin Rust + wasm32 target
├── plan.md                   # This file
├── AGENTS.md                 # Instructions for Claude Code
│
├── common/                   # Shared types (no platform-specific deps)
│   ├── Cargo.toml
│   ├── crate.nix
│   └── src/
│       └── lib.rs            # Repo, Terminal, TerminalStatus, Worktree,
│                             # WS protocol messages, API types
│
├── server/                   # Axum server (PTY management, WS, API)
│   ├── Cargo.toml
│   ├── crate.nix
│   └── src/
│       ├── main.rs           # Axum setup, state init, route mounting
│       ├── pty.rs            # PTY spawn/read/write/resize/kill
│       ├── terminal.rs       # Terminal CRUD on AppState
│       ├── worktree.rs       # git worktree create/list/remove/status
│       ├── registry.rs       # Repo name→url registry, JSON persistence
│       ├── api.rs            # HTTP API handlers (JSON)
│       └── ws.rs             # WebSocket handler for raw PTY I/O
│
├── client/                   # Leptos CSR app (compiled to WASM via Trunk)
│   ├── Cargo.toml
│   ├── crate.nix
│   ├── Trunk.toml
│   ├── index.html
│   ├── style.css
│   ├── js/
│   │   └── ghostty-bridge.js  # ghostty-web lifecycle (ONLY JS interop point)
│   └── src/
│       ├── main.rs            # Leptos mount
│       ├── app.rs             # Root component + router
│       ├── terminal.rs        # wasm-bindgen bridge to ghostty-bridge.js
│       ├── sidebar.rs         # Repo tree + session list + status icons
│       ├── terminal_view.rs   # Terminal pane (mounts ghostty-web)
│       ├── terminal_tabs.rs   # Tab bar for worktree terminals
│       ├── new_session.rs     # New session dialog
│       └── add_repo.rs        # Add repo dialog
│
└── tests/                    # e2e tests
    ├── playwright.config.ts
    └── e2e/
        ├── smoke.spec.ts     # Phase 0: page loads
        ├── terminal.spec.ts  # Phase 1: terminal renders, input works
        ├── session.spec.ts   # Phase 2: create/switch/kill sessions
        ├── registry.spec.ts  # Phase 3: add/remove repos
        └── worktree.spec.ts  # Phase 4: worktree sessions
```

### Why client/server/common?

- **client** builds via Trunk to WASM. It should not depend on `portable-pty`,
  `tokio`, or any server-only crate.
- **server** is a native binary. It should not depend on `wasm-bindgen`,
  `web-sys`, or any client-only crate.
- **common** is the bridge: shared data types, WS protocol, API request/response
  shapes. Both client and server depend on it. It has no platform-specific
  dependencies — just `serde` and standard library.

---

## Data Model

Lives in `common/src/lib.rs`. Used by both client and server.

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ── Repo Registry ──

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Repo {
    pub name: String,          // "payment-gateway" — unique key
    pub clone_url: String,     // "git@github.com:juspay/payment-gateway.git"
    pub local_path: PathBuf,   // where the main clone lives
}

// ── Terminal ──

pub type TerminalId = String;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum TerminalStatus {
    Running,       // PTY alive, recent output (< 5s)
    Idle,          // PTY alive, no recent output
    Exited(i32),   // PTY exited with code
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Terminal {
    pub id: TerminalId,        // globally unique
    pub label: String,         // display name: "opencode", "shell"
    pub command: Vec<String>,  // e.g. ["opencode"] or ["bash"]
    pub status: TerminalStatus,
}

// ── Worktree ──

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Worktree {
    pub repo: String,                   // references Repo.name
    pub branch: String,                 // "feat/auth-refactor"
    pub path: PathBuf,                  // <repo_local_path>/.worktrees/<branch>/
    pub terminal_ids: Vec<TerminalId>,
}

// ── WebSocket Protocol ──

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
    Resize { cols: u16, rows: u16 },
    // Raw PTY input is sent as binary frames, not JSON
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsServerMessage {
    Exit { exit_code: i32 },
    // Raw PTY output is sent as binary frames, not JSON
}
```

### Terminal ID Convention

Terminal IDs are human-readable and globally unique:

- Worktree terminal: `"{repo}/{branch}/{label}"` — e.g. `"payment-gateway/feat-auth/opencode"`
- Plain terminal: `"{label}"` — e.g. `"scratch"`

If the ID already exists, **reject the creation with an error**. The user
must pick a different label. No auto-numbering.

### Worktree Storage

Worktrees are stored **inside the repo clone**:

```
~/repos/payment-gateway/           ← Repo.local_path
├── .git/
├── .worktrees/                    ← added to .gitignore
│   ├── feat-auth-refactor/        ← git worktree (sanitized branch name)
│   └── fix-timeout-bug/           ← git worktree
├── src/
└── ...
```

Command: `git worktree add .worktrees/<sanitized_branch> <branch>`

Benefits: deleting the repo clone cleans up all worktrees. No separate
config directory to manage. Everything co-located.

### The Three-Level Tree (Sidebar)

```
Repos
├── payment-gateway           ← Repo
│   ├── feat/auth-refactor    ← Worktree
│   │   ├── opencode          ← Terminal [●]
│   │   ├── shell             ← Terminal [○]
│   │   └── cargo test        ← Terminal [○]
│   └── fix/timeout-bug       ← Worktree (collapsed) [●]
├── checkout-sdk              ← Repo
│   └── feat/new-flow         ← Worktree
│       └── claude-code       ← Terminal [●]
Plain
├── scratch                   ← Terminal [○]
```

Navigation:

- Click **Worktree** → show its terminals as tabs, activate the first
- Click **Terminal** leaf → switch directly to that tab
- Collapsed worktree → aggregate status: green if any child Running

---

## Phases

Each phase produces a working, runnable binary. `nix build` and `nix run`
must pass. e2e tests must pass. Verify before moving on.

---

### Phase 0: Hello World ✅

**Goal:** Cargo workspace with three crates, Leptos CSR page that says
"kolu" served by Axum, Nix build, Playwright smoke test, justfile.

**Build:**

Workspace setup:

- `Cargo.toml` workspace with `common`, `server`, `client`
- `rust-toolchain.toml` pinning stable + `wasm32-unknown-unknown` target
- `common/src/lib.rs` — empty, just `pub fn hello() -> &'static str { "kolu" }`
- `server/src/main.rs` — Axum server, serves static files from client dist,
  one route `GET /api/health` returning `"ok"`
- `client/src/main.rs` — Leptos CSR app rendering `<h1>"kolu"</h1>`
- `client/Trunk.toml` — proxy `/api` and `/ws` to server port
- `client/index.html` — minimal HTML shell for Trunk

Nix:

- `flake.nix` using flake-parts + rust-flake (crane)
- Client: crane + wasm-bindgen build, output is static dist directory
- Server: crane build, output is native binary
- Wrapper: `nix run` starts server with client dist embedded/served
- `nix build` produces the combined artifact

Dev workflow (`justfile`):

```just
dev:
    # Runs server (cargo watch) + client (trunk serve) in parallel
    parallel ::: "just server" "just client"

server:
    cd server && cargo watch -x run

client:
    cd client && trunk serve

build:
    nix build

run:
    nix run

test:
    npx playwright test

install:
    cd client && npm install  # ghostty-web (dev only; Nix builds bundle it)
```

e2e test (`tests/e2e/smoke.spec.ts`):

```typescript
test("page loads", async ({ page }) => {
  await page.goto("http://localhost:7681");
  await expect(page.locator("h1")).toContainText("kolu");
});
```

**Test:** `nix build` succeeds → `nix run` starts server → browser shows
"kolu" → `just test` passes → `just dev` starts hot reload workflow.

**This phase has zero domain logic.** It's pure build infrastructure.

---

### Phase 1: One terminal in the browser ✅

**Goal:** A single PTY rendered via ghostty-web in the Leptos app. Prove
the full stack works end-to-end: Axum → PTY → broadcast → WebSocket →
ghostty-bridge.js → ghostty-web canvas.

**Build:**

`common/src/lib.rs`:

- Add `WsClientMessage`, `WsServerMessage` enums (from Data Model above)

`server/src/pty.rs`:

- `pub fn spawn(cmd: &[String], cwd: &Path, cols: u16, rows: u16) -> Result<PtyHandle>`
- `PtyHandle`: the `portable_pty` master writer, a `broadcast::Sender<Bytes>`,
  a tokio task handle for the reader loop, a `VecDeque<u8>` scrollback
  (capped 100KB)
- Reader task: reads from PTY master in a loop, appends to scrollback,
  sends on broadcast channel
- `pub fn write(handle: &PtyHandle, data: &[u8])`
- `pub fn resize(handle: &PtyHandle, cols: u16, rows: u16)`
- `pub fn kill(handle: &PtyHandle)`

`server/src/ws.rs`:

- Axum handler at `GET /ws/:terminal_id`
- On connect: send scrollback as initial binary frame(s)
- Subscribe to broadcast channel: forward PTY output → WS binary frames
- Forward WS binary frames → PTY writer
- Handle `WsClientMessage::Resize` JSON messages

`server/src/main.rs`:

- On startup: spawn one hardcoded PTY (`["bash"]` in `$HOME`)
- Store `PtyHandle` in Axum state
- Mount WS route + static file serving

`client/js/ghostty-bridge.js`:

- `initGhostty()` — dynamically imports ghostty-web, calls `init()`
- `createTerminal(elementId, wsUrl, config)` — creates Terminal, opens WS,
  wires onData/onmessage, sets up ResizeObserver
- `destroyTerminal(handle)` — closes WS, disconnects observer, disposes

`client/src/terminal.rs`:

- `wasm-bindgen` extern declarations for `ghostty-bridge.js` functions

`client/src/terminal_view.rs`:

- Leptos component `<TerminalView id=... />`
- On mount: calls `initGhostty()` then `createTerminal()`
- Renders a `<div id="terminal-{id}">` that ghostty-web fills

`client/src/app.rs`:

- Renders just `<TerminalView id="default" />`

e2e test (`tests/e2e/terminal.spec.ts`):

```typescript
test("terminal renders and accepts input", async ({ page }) => {
  await page.goto("http://localhost:7681");
  // Wait for terminal canvas to appear
  await expect(page.locator("canvas")).toBeVisible();
  // Type a command
  await page.keyboard.type("echo hello\n");
  // Verify output appears (check terminal content or just no errors)
});
```

**Test:** `nix run` → browser shows bash in ghostty-web → type commands →
see output → close tab → reopen → scrollback replayed → `just test` passes.

---

### Phase 2: Multiple plain terminals + sidebar

**Goal:** Create, list, switch, kill terminals. The sidebar lists them
with status indicators. This is the "tmux replacement" moment.

**Build:**

`common/src/lib.rs`:

- Add `Terminal`, `TerminalId`, `TerminalStatus` types
- API request/response types: `CreateTerminalRequest { label, command }`,
  `TerminalList(Vec<Terminal>)`, etc.

`server/src/terminal.rs`:

- `AppState` with `DashMap<TerminalId, LiveTerminal>`
- `LiveTerminal` holds: `Terminal` info, `PtyHandle`, `last_output_at: Instant`
- `pub fn create(state, id, label, command, cwd) → Result<Terminal>`
  - Rejects if `id` already exists
- `pub fn list(state) → Vec<Terminal>`
- `pub fn get(state, id) → Option<Terminal>`
- `pub fn kill(state, id) → Result<()>`
- Status sweep: periodic tokio task (every 2s) updates status based on
  `last_output_at` and `child.try_wait()`

`server/src/api.rs`:

- `POST /api/terminals` — create terminal
- `GET /api/terminals` — list all
- `DELETE /api/terminals/:id` — kill

`client/src/sidebar.rs`:

- Fetches terminal list (polling every 2s via `set_interval`)
- Flat list with status indicators:
  - `●` green pulse = Running
  - `○` hollow = Idle
  - `✕` = Exited
- Click to select → updates `active_terminal_id` signal
- "+ new" button

`client/src/new_session.rs`:

- Form: label + command (default "bash")
- Calls `POST /api/terminals`
- Auto-selects the new terminal

`client/src/terminal_view.rs` update:

- Reacts to `active_terminal_id` signal
- On change: destroy old terminal, create new one

`client/src/app.rs` update:

- Layout: sidebar (fixed 260px) + terminal pane (flex)

e2e tests (`tests/e2e/session.spec.ts`):

- Create 3 terminals, switch between them
- Kill one, verify it shows as exited
- Verify no duplicate IDs accepted

**Test:** Create terminals → switch → kill → status indicators update →
`just test` passes.

---

### Phase 3: Repo registry

**Goal:** Register repos (name → clone URL → local path). Persisted as
JSON. No worktrees yet — just the registry.

**Build:**

`common/src/lib.rs`:

- Add `Repo` type
- API types: `AddRepoRequest { name, clone_url, local_path }`

`server/src/registry.rs`:

- `pub fn load(config_dir: &Path) → Vec<Repo>`
- `pub fn save(config_dir: &Path, repos: &[Repo])`
- `pub fn add(repos: &mut Vec<Repo>, name, clone_url, local_path) → Result<Repo>`
  - If `local_path` doesn't exist and `clone_url` provided: `git clone`
    (via `tokio::process::Command` for async)
  - Rejects if name already exists
- `pub fn remove(repos: &mut Vec<Repo>, name) → Result<()>`
- File: `~/.config/kolu/repos.json`

`server/src/api.rs` additions:

- `GET /api/repos` — list repos
- `POST /api/repos` — add repo
- `DELETE /api/repos/:name` — remove repo

`client/src/sidebar.rs` update:

- Two sections: "Repos" (just names, not expandable yet) and "Plain"
  (terminals from Phase 2)
- "+ repo" button

`client/src/add_repo.rs`:

- Form: name + clone URL + local path

e2e tests (`tests/e2e/registry.spec.ts`):

- Add a repo → appears in sidebar → restart → persisted → remove → gone
- Reject duplicate repo name

**Test:** Add repos → persist across restart → remove → `just test` passes.

---

### Phase 4: Worktrees + worktree terminals

**Goal:** Create worktrees for repos. Spawn terminals inside worktrees.
The sidebar becomes the three-level tree. Terminal tabs appear.

**Build:**

`common/src/lib.rs`:

- Add `Worktree` type
- Extend `Terminal` with `worktree: Option<(String, String)>` (repo, branch)
- API types: `CreateWorktreeRequest`, `CreateWorktreeTerminalRequest`

`server/src/worktree.rs`:

- All operations shell out to `git` (no git2 crate)
- `pub fn create(repo_local_path: &Path, branch: &str) → Result<PathBuf>`
  - Sanitizes branch name for directory: `feat/auth` → `feat-auth`
  - Runs: `git worktree add .worktrees/<sanitized> <branch>`
  - Adds `.worktrees/` to repo's `.gitignore` if not already there
  - Returns the worktree path
- `pub fn list(repo_local_path: &Path) → Result<Vec<WorktreeInfo>>`
  - Parses `git worktree list --porcelain`
  - Filters to only those under `.worktrees/`
- `pub fn remove(repo_local_path: &Path, branch: &str) → Result<()>`
  - Runs: `git worktree remove .worktrees/<sanitized>`

`server/src/terminal.rs` update:

- `create` now accepts optional `(repo_name, branch)` — if provided, looks
  up worktree path and uses it as cwd
- Terminal ID for worktree terminals: `"{repo}/{branch}/{label}"`
- Maintains a `DashMap<(String, String), Worktree>` for worktree state

`server/src/api.rs` additions:

- `POST /api/repos/:name/worktrees` — create worktree
- `GET /api/repos/:name/worktrees` — list worktrees for a repo
- `DELETE /api/repos/:name/worktrees/:branch` — remove worktree
- `POST /api/repos/:name/worktrees/:branch/terminals` — create terminal in worktree

`client/src/sidebar.rs` — rewrite to three-level tree:

- Repos → Worktrees → Terminals (as shown in mockup)
- Collapsible nodes
- Aggregate status on collapsed worktrees
- Click worktree → show its terminals as tabs

`client/src/terminal_tabs.rs`:

- Tab bar above terminal pane
- One tab per terminal in the active worktree
- Status dot per tab
- "+ terminal" button (spawns new terminal in current worktree)
- Close button per tab (kills terminal, with confirm if Running)

`client/src/new_session.rs` update:

- Two modes: "worktree terminal" (pick repo → enter branch → label + command)
  and "plain terminal" (label + command)
- Auto-creates worktree if it doesn't exist

`client/src/app.rs` update:

- Breadcrumb bar: `repo / branch / terminal` (or just `terminal` for plain)
- Layout: sidebar | (breadcrumb + tabs + terminal pane)

e2e tests (`tests/e2e/worktree.spec.ts`):

- Add repo → create worktree → create terminal in it → verify cwd is correct
- Create two terminals in same worktree → switch via tabs
- Create two worktrees in same repo → switch via sidebar
- Verify worktree stored at `repo/.worktrees/branch/`
- Reject duplicate terminal label within same worktree

**Test:** Full three-level tree navigation works → tab switching works →
worktrees stored inside repos → `just test` passes.

---

### Phase 5: Git status + activity polish

**Goal:** Surface git information. Activity indicators refined.

**Build:**

`server/src/worktree.rs` additions:

- `pub fn status(worktree_path: &Path) → Result<WorktreeStatus>`
  - `git status --porcelain` for dirty count
  - `git rev-list --left-right --count HEAD...@{upstream}` for ahead/behind
- `pub fn diff_stat(worktree_path: &Path) → Result<String>`
  - `git diff --stat`

`common/src/lib.rs`:

- Add `WorktreeStatus { branch, dirty_files, ahead, behind }`

`server/src/api.rs` additions:

- `GET /api/repos/:name/worktrees/:branch/status`
- `GET /api/repos/:name/worktrees/:branch/diff`

UI additions:

- Worktree nodes show dirty file count badge
- Breadcrumb bar shows `+N -M dirty` badge
- Conflict indicator: if two worktrees in the same repo modify overlapping
  files, show warning (compare `git diff --name-only` across worktrees)

**Test:** Agent modifies files → dirty count updates → switch worktrees →
each has independent status → `just test` passes.

---

### Phase 6: UX polish

**Goal:** Keyboard shortcuts, resize handling, error toasts, theme.

- Ctrl+1..9 switch tabs, Ctrl+T new terminal, Ctrl+W kill terminal
- Debounced terminal resize
- Error toasts (git clone failed, PTY spawn failed, duplicate ID)
- Tokyo Night theme (matching the prototype)
- Collapsible sidebar on narrow viewports
- Session persistence: serialize terminal list to JSON on state change;
  on startup, load and mark all as Exited (PTYs don't survive restart)

---

## Driving Claude Code

### Phase prompt template

```
We are building kolu. Read plan.md and AGENTS.md.

We are implementing Phase N: [phase name].

Constraints (always):
- Simple Made Easy: no trait objects, no Arc<Mutex>, no manager objects,
  no builder pattern. Plain functions on plain data.
- Three-crate workspace: common/ (shared types), server/ (axum),
  client/ (Leptos CSR + Trunk).
- Shell out to git (no git2 crate).
- ghostty-web interop via ghostty-bridge.js only.
- JSON files for persistence.
- Terminal IDs must be unique — reject duplicates, don't auto-number.
- Worktrees stored at <repo>/.worktrees/<branch>/
- `nix build` and `nix run` must work when this phase is done.
- e2e tests (Playwright) for this phase's features.
- Use justfile for dev recipes.

Goal: [copy Goal line]
Build: [copy Build section]
Test: [copy Test section]

Do NOT build anything from later phases.
Do NOT add abstractions "for future use".
Write the simplest code that satisfies this phase.
```

### Review checklist (run after each phase)

Before starting the next phase:

1. **Does `nix build` succeed?**
2. **Does `nix run` work end-to-end?** Browser → expected behavior.
3. **Does `just test` pass?** All e2e tests green.
4. **Is each module independent?** Check imports in each `.rs` file.
   Only `common::` types should cross crate boundaries.
5. **Any `Arc<Mutex<...>>`?** Replace with DashMap or channels.
6. **Any unnecessary abstraction?** Traits with one implementor?
   Builder patterns? Remove them.
7. **Is the JS interop contained?** All ghostty-web interaction should
   be in `ghostty-bridge.js`. No ghostty-web imports in Rust.
8. **Are terminal IDs unique by rejection?** No auto-numbering anywhere.
9. **Does the justfile have recipes for this phase's workflow?**

---

## Future Milestones

Deferred. Do not build these during Phases 0–6. They can be added later
without changing the architecture.

### Agent activity detection

Distinguish "agent is actively coding" vs "agent is waiting for input"
vs "agent is waiting for compilation". Currently we use a 5-second output
heuristic. Future: parse terminal output for known agent prompts, or
integrate with agent-specific status APIs.

### PTY detachment / survival across server restarts

Currently, server restart = all terminals exited. To survive restarts,
we'd need Unix socket-based PTY detachment (like tmux/abduco). This is
complex and only needed when the server is not long-running.

### Split panes

Side-by-side terminals within the terminal pane. For now, use multiple
browser windows or tabs. Avoids enormous UI complexity.

### juspay/AI integration

Add as a flake output in `juspay/AI`. Session creation accepts agent
variants (`opencode-juspay-oneclick`, etc.). `.agents/` skills auto-wired
via `nix-agent-wire`.

### Multi-user / team features

Auth layer, session ownership, spectator mode, shared team server,
remote compute.

### Notifications

Slack webhook when agent finishes. Browser notifications when a
background session needs input.

### Metrics

Tokens used per session, time-to-completion, CI pass rate per agent
variant.

### Auto-PR pipeline

Session completes → auto-create PR with diff + session transcript.
