<p align="center">
  <img src="client/favicon.svg" width="64" alt="kolu icon" />
</p>

# kolu

Web-based [Agentic Development Environment](https://x.com/jdegoes/status/2036931874057314390) (ADE) built on terminals.

Named after [கோலு](<https://en.wikipedia.org/wiki/Golu_(festival)>), the tradition of arranging figures on tiered steps.

## Usage

```sh
nix run github:juspay/kolu       # serve on 0.0.0.0:7681
nix run github:juspay/kolu -- --host 127.0.0.1 --port 8080  # custom bind
```

## Features

### Terminals

- Create, switch, kill, and drag-to-reorder terminals from a collapsible sidebar
- Split terminals — `Ctrl+`` splits a bottom pane per terminal; `Ctrl+Shift+``adds tabs,`Ctrl+PageDown/Up` cycles
- Font zoom (`Cmd/Ctrl +/-`), persisted per terminal across sessions
- WebGL rendering with canvas fallback, clickable URLs, Unicode 11, inline images (sixel, iTerm2, kitty)
- Lazy attach — late-joining clients receive serialized screen state (~4KB) instead of replaying raw buffer

### Navigation

- Command palette (`Cmd/Ctrl+K`) — search terminals, switch themes, run actions
- Mission Control (`Cmd/Ctrl+.` or `Ctrl+Tab`) — bird's eye grid of all terminals with live previews. Navigate with arrow keys, Tab, or number keys (1-9). `Ctrl+Tab` quick-switch uses MRU order: hold Ctrl, Tab through terminals, release to select — instant flip between two terminals
- Keyboard-driven — `Cmd+T` new terminal, `Cmd+1-9` jump, `Cmd+Shift+[/]` cycle, `Cmd+/` shortcuts help

### Git & GitHub

- Auto-detected repo name, branch, and working directory (via OSC 7 + `.git/HEAD` watcher)
- GitHub PR detection — shows PR number, title, and CI check status (pass/pending/fail) in header and sidebar
- Per-repo color coding in sidebar via golden-angle hue spacing
- Activity sparklines per terminal (5-minute rolling window)

### Claude Code Status

Detects [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions running in any terminal and shows their state in the header and sidebar.

**What we detect:**

| State    | Indicator          | Meaning                                              |
| -------- | ------------------ | ---------------------------------------------------- |
| Thinking | Pulsing accent dot | API call in flight — Claude is generating a response |
| Tool use | Pulsing yellow dot | Claude is executing tools or waiting for permission  |
| Waiting  | Dim dot            | Claude finished responding, waiting for user input   |

**How it works:** scans `~/.claude/sessions/` for active session PIDs, matches each session to a terminal via PTY path (`/proc/{pid}/fd/0`), then tails the session's JSONL transcript to derive state from the last message.

**What we can't detect:**

- **Permission prompts vs tool execution** — both show as "tool use" since the JSONL doesn't distinguish them
- **Streaming progress** — intermediate thinking tokens aren't tracked, only final state transitions
- **macOS** — PTY matching relies on `/proc`, which doesn't exist on macOS (Linux-only for now)
- **Sub-agents** — nested agent spawns appear as tool use, not as separate tracked sessions

### Theming

- 200+ color schemes from [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes), switchable at runtime
- Live preview while browsing themes in the palette
- Random theme per new terminal (toggleable)
- Dark / light / system UI theme

### Clipboard

- `Ctrl+V` pastes images into Claude Code via server-side clipboard shims

## Architecture

pnpm monorepo, four packages:

| Package       | Stack                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common/`     | [oRPC](https://orpc.dev/) contract + [Zod](https://zod.dev/) schemas                                                                             |
| `server/`     | [Hono](https://hono.dev/) + [node-pty](https://github.com/microsoft/node-pty) + [@xterm/headless](https://www.npmjs.com/package/@xterm/headless) |
| `client/`     | [SolidJS](https://www.solidjs.com/) + [solid-live](solid-live/) + [xterm.js](https://xtermjs.org/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| `solid-live/` | End-to-end reactive signals — `@solidjs/signals` on server, SolidJS `Accessor` on client, `AsyncIterable` on the wire                            |

### Communication

All traffic flows over a single WebSocket (`/rpc/ws`) via [oRPC](https://orpc.dev/). The contract in `common/` is shared by both sides — types checked at compile time, payloads validated by Zod at runtime. Three patterns[^orpc-patterns]:

| Pattern            | Semantics                         | Client integration                             | Used for                                                      |
| ------------------ | --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Request / response | one-shot                          | Plain `client.*` calls[^rr]                    | `terminal.create`, `terminal.kill`, `terminal.reorder`        |
| Live subscription  | each push replaces previous value | `createSubscription()` from `solid-live/solid` | Terminal list, terminal metadata (CWD, git, PR, Claude state) |
| Accumulated stream | pushes accumulate into an array   | `createSubscription()` with `reduce` option    | Activity sparklines                                           |

Server state (terminal list, metadata, preferences) is modeled with `@solidjs/signals` and bridged to `AsyncIterable` via `toAsyncIterable()` from `solid-live/server`. Discrete events (PTY data, activity, exit) use `@orpc/experimental-publisher`.

[^rr]: Mutations are plain async oRPC calls. The server's signal-driven live subscription pushes authoritative state immediately after mutation — no client-side cache management needed. High-frequency calls (`sendInput`, `resize`) use the raw oRPC client directly.

### Data flow

Two loops drive the system — a **terminal I/O loop** (the hot path) and a **metadata loop** (side-channel enrichment). Both flow over the same WebSocket. Server state is modeled with `@solidjs/signals` and streamed to `createSubscription()` on the client via `toAsyncIterable()`.

```mermaid
flowchart TB
  subgraph Client["Client (SolidJS)"]
    User((User)):::user
    Xterm["xterm.js\nrender + input"]:::client
    Subs["createSubscription\nsolid-live signals"]:::cache
    UI["UI components\nsidebar · header · palette"]:::client
  end

  subgraph Server["Server (Hono + @solidjs/signals)"]
    PTY["node-pty\nshell process"]:::server
    Headless["@xterm/headless\nscreen state"]:::server
    Signals["Signals\nlist · metadata · state"]:::server
    Pub["Publisher\nevents only"]:::server
    Providers["Metadata providers"]:::server
  end

  %% Terminal I/O loop
  User -->|"keystroke"| Xterm
  Xterm -->|"sendInput\n(request/response)"| PTY
  PTY -->|"shell output"| Headless
  PTY -->|"shell output"| Pub
  Pub -->|"attach stream"| Xterm

  %% Metadata loop
  PTY -.->|"OSC 7\n(CWD change)"| Providers
  Providers -.->|"set signals"| Signals
  Signals -.->|"toAsyncIterable\n(live subscription)"| Subs
  Pub -.->|"activity stream\n(accumulated)"| Subs
  Subs -.-> UI

  %% User actions
  UI -->|"create · kill · reorder\n(request/response)"| PTY

  classDef user fill:#f4a261,stroke:#e76f51,color:#000
  classDef client fill:#2a9d8f,stroke:#264653,color:#fff
  classDef cache fill:#e76f51,stroke:#f4a261,color:#fff
  classDef server fill:#264653,stroke:#2a9d8f,color:#fff

  style Client fill:none,stroke:#2a9d8f,stroke-width:2px,color:#2a9d8f
  style Server fill:none,stroke:#264653,stroke-width:2px,color:#264653
```

**Terminal I/O** (solid lines) — keystrokes go through `sendInput` RPC to node-pty; shell output flows back through the [publisher](server/src/publisher.ts) as an `attach` stream to xterm.js. An @xterm/headless instance parses VT sequences server-side for screen-state snapshots[^lazy-attach].

**Metadata** (dashed lines) — shell activity triggers a reactive provider DAG: CWD changes (OSC 7) → git provider (.git/HEAD watcher) → GitHub provider (`gh pr view` polling). A Claude provider independently polls `~/.claude/sessions/`. All providers update `@solidjs/signals` which are streamed to the client as live subscriptions via `toAsyncIterable()`[^providers].

**User actions** — command palette and sidebar dispatch plain RPC calls ([`useTerminalCrud`](client/src/useTerminalCrud.ts), [`useWorktreeOps`](client/src/useWorktreeOps.ts)). Mutations hit the server directly; the server's signal-driven live subscription pushes authoritative state immediately. [`useTerminalMetadata`](client/src/useTerminalMetadata.ts) manages dynamic per-terminal `createSubscription` instances that derive terminal IDs from the live list subscription and reactively resize as terminals come and go[^client-state].

[^lazy-attach]: ~4 KB serialized snapshot instead of replaying the full scrollback buffer.

[^providers]: Git provider uses [simple-git](https://github.com/steveukx/git-js); GitHub provider derives combined CI status from `CheckRun` + `StatusContext`; Claude provider matches PIDs to PTYs via `/proc/{pid}/fd/0`.

[^client-state]: Local-only view state (active terminal, MRU order, attention flags) lives in SolidJS [signals and stores](https://docs.solidjs.com/reference/store-utilities/create-store) inside singleton `useXxx.ts` modules — separate from the server-pushed subscriptions.

**Persistence** — sessions auto-save to `~/.config/kolu/state.json` via [`conf`](https://github.com/sindresorhus/conf), debounced at 500 ms[^persistence].

[^persistence]: Schema is versioned with explicit migrations. Stores CWD, sort order, and parent relationships per terminal.

[PartySocket](https://docs.partykit.io/reference/partysocket-api/) handles WebSocket auto-reconnect; server restarts are detected via a `processId` probe.

### Build & packaging

Packaged with [Nix](https://nixos.asia/en/install). The flake has **zero inputs** — nixpkgs and other sources are pinned via [npins](https://github.com/andir/npins) and imported with `fetchTarball` to keep `nix develop` fast (~2.6 s cold). Shared env vars are defined once in `koluEnv` and consumed by both the build and the devShell[^build].

[^build]: `koluEnv` includes `KOLU_THEMES_JSON`, font paths, and clipboard shims. The final derivation is a wrapper script that sets the environment and execs [`tsx`](https://tsx.is/).

## Development

Requires [Nix](https://nixos.asia/en/install) with flakes enabled.

```sh
nix develop     # enter devshell
just dev        # run server + client with hot reload
just test       # e2e tests (full nix build)
```

## CI

`just ci` builds all flake outputs on x86_64-linux and aarch64-darwin in parallel, runs e2e tests, and posts GitHub commit statuses. See [`ci/`](ci/) for details and reuse instructions.

```sh
just ci              # full CI run
just ci::protect     # set branch protection
just ci::_summary    # check current status
```

## Deployment (NixOS + home-manager)

A home-manager module runs kolu as a systemd user service:

```nix
{
  imports = [ kolu.homeManagerModules.default ];
  services.kolu = {
    enable = true;
    package = kolu.packages.${system}.default;
    host = "127.0.0.1"; # default
    port = 7681;         # default
  };
}
```

See [`nix/home/example/`](nix/home/example/) for a full configuration with a VM test.
