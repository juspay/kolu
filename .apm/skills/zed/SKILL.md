---
name: zed
description: >-
  Reference for how Zed implements remote development over SSH — host discovery
  from ~/.ssh/config, length-prefixed protobuf RPC over a single multiplexed
  ssh stdio channel, auto-installed `zed-remote-server` binary, headless project
  on the remote exposing the same WorktreeStore / GitStore / LspStore /
  AgentServerStore the local client uses, heartbeat-driven reconnect, and
  PTY-over-ssh for terminals. Trigger when designing or reviewing remote /
  SSH features in Kolu (file tree on remote, git status on remote, remote
  terminal, agent state on remote, network-blip resilience, ~/.ssh/config
  picker), or when comparing Kolu's approach against the prior-art reference.
---

# Zed remote-development reference

Zed ships first-class SSH remoting: open a project on `Host srid-build-box`,
edit files, run terminals, see git status, run LSPs, all transparently. The
local Zed window is a thin client; the heavy lifting runs in
`zed-remote-server` on the remote host. The transport is one ssh subprocess
carrying a length-prefixed protobuf RPC channel.

Source for study (clone if absent):

```
git clone --depth=1 https://github.com/zed-industries/zed /tmp/zed
```

Pin used to verify everything below: `3a81f8e9` (v1.5.0). All file:line
references resolve in that tree.

## Crate map

| Crate | Role |
|---|---|
| `remote` | Client-side: `RemoteClient`, `RemoteConnection` trait, ssh/wsl/docker/mock transports, length-prefixed protobuf protocol |
| `remote_connection` | Type re-exports + minor glue |
| `remote_server` | The binary deployed on the remote — main + `HeadlessProject` |
| `recent_projects` | UI: SSH host picker, ~/.ssh/config parser & watcher, disconnected-overlay modal |
| `project` | Shared "project" model: `WorktreeStore`, `GitStore`, `LspStore`, `AgentServerStore` — same types both sides; `.local()` / `.remote()` constructors, `.shared(project_id, session, cx)` to multiplex |
| `worktree` | `Worktree::Local` + `Worktree::Remote(RemoteWorktree)` — snapshot replicated via `proto::UpdateWorktree` |

## SSH host discovery (~/.ssh/config)

Zed's parser is intentionally minimal: scan lines, collect `Host` aliases,
drop git-provider hostnames so you don't accidentally see `github.com` in
the picker.

- Parser: `/tmp/zed/crates/recent_projects/src/ssh_config.rs:17` (`parse_ssh_config_hosts`).
- Git-provider filter list: `/tmp/zed/crates/recent_projects/src/ssh_config.rs:3-15` —
  `github.com`, `gitlab.com`, `bitbucket.org`, `codeberg.org`, `gitee.com`,
  `gitea.com`, `dev.azure.com`, `chromium.googlesource.com`, `sourcehut.org`,
  `git.sr.ht`, `gist.github.com`.
- Live watch on user + global config files:
  `/tmp/zed/crates/recent_projects/src/remote_servers.rs:2895`
  (`spawn_ssh_config_watch`). Reads change automatically — no Zed restart.

## Wire protocol

Length-prefixed protobuf `Envelope` (from `rpc::proto`).

- Wire format: 4-byte little-endian length, then the protobuf-encoded `Envelope`.
- Read/write helpers: `/tmp/zed/crates/remote/src/protocol.rs:16-52`.
- One stream per SSH session; `Envelope` is the discriminated union of every
  RPC the system uses.

## Remote-server bootstrap

On first connect, `SshRemoteConnection::ensure_server_binary` checks
existence and installs `zed-remote-server-{channel}-{version}{.exe}` under
`paths::remote_server_dir_relative()` (typically `~/.local/share/zed/remote_server/`).

- Three strategies in order
  (`/tmp/zed/crates/remote/src/transport/ssh.rs:785-916`):
  1. **Dev build from source** (gated by `ZED_BUILD_REMOTE_SERVER`) — uploads via SCP.
  2. **Remote downloads from HTTP URL** — `delegate.get_download_url(...)` returns
     a URL the remote can curl directly. Avoids one-direction bandwidth pinch.
  3. **Local downloads + upload via SCP/SFTP** — fallback when (2) fails.
- Existence probe: `ssh ... <path> version`
  (`/tmp/zed/crates/remote/src/transport/ssh.rs:809-818`).
- Binary name carries release channel + version, so multiple Zed installs
  coexist on the same host without colliding
  (`/tmp/zed/crates/remote/src/transport/ssh.rs:796-805`).

## HeadlessProject — what runs on the remote

`HeadlessProject` (`/tmp/zed/crates/remote_server/src/headless_project.rs:51-73`)
holds the same store types the local client uses, each constructed as
`.local(...)` and then `.shared(REMOTE_SERVER_PROJECT_ID, session, cx)`:

| Store | Init | Purpose |
|---|---|---|
| `WorktreeStore` | `:107-111` | File-tree snapshot, `proto::UpdateWorktree` deltas |
| `BufferStore`   | `:136-140` | Text buffers / file contents |
| `BreakpointStore` | `:142-148` | Debugger breakpoints |
| `DapStore`      | `:150-164` | Debug adapter lifecycle |
| `GitStore`      | `:166-176` | Git state (status, branches, blame, diffs) |
| `LspStore`      | `:212-231` | Language servers (started on remote) |
| `AgentServerStore` | `:235-245` | External agents (Copilot, ACP, etc.) |
| `ContextServerStore` | `:247-252` | MCP / context servers |
| `TaskStore`     | `:188-199` | Tasks |
| `SettingsObserver` | `:200-210` | Settings sync |

The pattern: every store is the *same Rust type* as the local one — it just
gets `.shared(...)` over the RPC session
(`/tmp/zed/crates/remote_server/src/headless_project.rs:278-289`). The
client side mirrors with a `.remote(...)` constructor (e.g.
`AgentServerStore::remote` at
`/tmp/zed/crates/project/src/agent_server_store.rs:675-688`).

This is the load-bearing design choice: there is **no** separate
client/server protocol per feature. Every store does its own RPC via the
shared session, multiplexed inside one `Envelope` stream.

## Worktree on remote

`Worktree` is `Local(LocalWorktree) | Remote(RemoteWorktree)`
(`/tmp/zed/crates/worktree/src/worktree.rs:95`). `RemoteWorktree`
(`/tmp/zed/crates/worktree/src/worktree.rs:157-170`) holds:

- a replicated `Snapshot` (entries by path + by id, scan id, repo root common dir),
- a background snapshot + pending `proto::UpdateWorktree` queue,
- the `AnyProtoClient` it talks back through,
- `disconnected: bool` flag for UI state.

Update flow: server scans → packs `UpdateWorktree` proto → client receives
in `update_from_remote()` (`:2092`) → applies in `apply_remote_update()`
(`:2479`).

## Terminals — PTY-over-ssh, not RPC

Zed does **not** ship terminal bytes through the protobuf channel. Each
remote terminal is a local `ssh -t` subprocess; node-pty equivalents hold
the local PTY, the remote shell runs underneath ssh's TTY allocation.

- `create_remote_shell` builds the command:
  `/tmp/zed/crates/project/src/terminals.rs:609-642`. Returns
  `Shell::WithArguments { program: "ssh", args: [...], title_override: "<host> — Terminal" }`.
- `Interactive::Yes | No` enum
  (`/tmp/zed/crates/remote/src/remote_client.rs:118-123`) drives the
  `-t` vs `-T` flag (POSIX command builder at
  `/tmp/zed/crates/remote/src/transport/ssh.rs:1869-1874`).
- Working directory is `cd $WORKING_DIR && exec env $ENV $shell -l` quoted
  through the remote shell, with `~/` expanded via `$HOME`
  (`/tmp/zed/crates/remote/src/transport/ssh.rs:1791-1819`).

Implication: terminals do **not** survive a network drop. The ssh
subprocess dies with the network; the local PTY closes. Zed treats this
as a separate problem from the metadata channel (which heartbeats and
reconnects — see below).

## Heartbeat + reconnect

`RemoteClient` runs a heartbeat task; on misses it transitions through a
state machine to a reconnect attempt.

Constants (`/tmp/zed/crates/remote/src/remote_client.rs:149-155`):

| Constant | Value | Meaning |
|---|---|---|
| `MAX_MISSED_HEARTBEATS` | 5 | misses before reconnect |
| `HEARTBEAT_INTERVAL` | 5s | ping cadence |
| `HEARTBEAT_TIMEOUT` | 5s | per-ping deadline |
| `INITIAL_CONNECTION_TIMEOUT` | 60s (debug 5s) | first-connect cap |
| `MAX_RECONNECT_ATTEMPTS` | 3 | give-up threshold |

State machine (`/tmp/zed/crates/remote/src/remote_client.rs:157-185`):

```
Connecting
  └─→ Connected ──missed heartbeat──→ HeartbeatMissed(n)
                                         └──n < 5──→ recovers → Connected
                                         └──n = 5──→ Reconnecting
                                                       ├─→ Connected
                                                       └─→ ReconnectFailed(attempts)
                                                            └──attempts ≥ 3──→ ReconnectExhausted
ServerNotRunning  (remote_server exited)
```

On `ReconnectExhausted` or `ServerNotRunning`, `RemoteClient` emits
`Event::Disconnected { server_not_running }`.

## Disconnected UI

`DisconnectedOverlay`
(`/tmp/zed/crates/recent_projects/src/disconnected_overlay.rs:17-89`) is a
modal that subscribes to `Project::Event::DisconnectedFromRemote { server_not_running }`
and offers "Reconnect" → calls `open_remote_project()` with the saved
connection options + saved root paths. "Unsaved changes are stored locally"
is shown when `restore_unsaved_buffers` is set.

## Mock + multi-transport seam

`RemoteConnection` is a trait with three real impls + a mock:

- `/tmp/zed/crates/remote/src/transport/ssh.rs`
- `/tmp/zed/crates/remote/src/transport/wsl.rs`
- `/tmp/zed/crates/remote/src/transport/docker.rs`
- `/tmp/zed/crates/remote/src/transport/mock.rs`

Everything above the trait (stores, project, UI) is transport-agnostic.
Tests bypass ssh entirely via `MockConnection` /
`MockConnectionRegistry`.

## Quick reference

| Topic | File:line |
|---|---|
| ~/.ssh/config parser | `/tmp/zed/crates/recent_projects/src/ssh_config.rs:17` |
| ~/.ssh/config live watcher | `/tmp/zed/crates/recent_projects/src/remote_servers.rs:2895` |
| Length-prefixed protobuf wire | `/tmp/zed/crates/remote/src/protocol.rs:16-52` |
| Server-binary install | `/tmp/zed/crates/remote/src/transport/ssh.rs:785-916` |
| `HeadlessProject` ctor | `/tmp/zed/crates/remote_server/src/headless_project.rs:91-289` |
| `RemoteWorktree` | `/tmp/zed/crates/worktree/src/worktree.rs:157-170` |
| Terminal-over-ssh builder | `/tmp/zed/crates/project/src/terminals.rs:609-642` |
| `Interactive` enum | `/tmp/zed/crates/remote/src/remote_client.rs:118-123` |
| POSIX ssh command builder | `/tmp/zed/crates/remote/src/transport/ssh.rs:1768-1884` |
| Heartbeat constants | `/tmp/zed/crates/remote/src/remote_client.rs:149-155` |
| Connection state machine | `/tmp/zed/crates/remote/src/remote_client.rs:157-293` |
| `DisconnectedOverlay` | `/tmp/zed/crates/recent_projects/src/disconnected_overlay.rs:17-214` |
| `AgentServerStore::remote` | `/tmp/zed/crates/project/src/agent_server_store.rs:675-688` |
| Mock transport | `/tmp/zed/crates/remote/src/transport/mock.rs` |
