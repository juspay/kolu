---
name: zed
description: >-
  Zed's SSH-based remote development architecture as a reference for building
  Kolu's remote terminal support. Reach for this skill when designing or
  implementing anything in the remote-terminal feature surface — Host
  abstraction, kolu-remote-server design, wire protocol choices, subscription
  RPC, headless provider hosting on the remote, cross-arch deployment, OSC
  injection across SSH, foreground-PID tracking on remote process trees,
  ControlMaster multiplexing, server-binary bootstrap, or any question of
  the form "how does Zed handle X for remote?" Cite the file paths inside
  the Zed source as ground truth (locally cloned at `/tmp/zed`, public source
  at `github.com/zed-industries/zed`).
---

# Zed's remote development as a design reference for Kolu

Zed ships SSH-based remote development with a UX goal similar to Kolu's: edit / interact with a remote host while the local UI stays responsive. Zed's solution has been in production since v0.157 and the design choices are battle-tested. This skill captures what's worth borrowing (and what isn't), so a Kolu designer building remote-terminal support doesn't have to re-derive answers from first principles.

Local clone for spelunking: `/tmp/zed/` (cloned with `--depth 1 --filter=blob:none`; re-clone from `https://github.com/zed-industries/zed.git` if missing). All file references below are paths inside that repo.

## The headline insight: terminals don't run on the remote

The biggest surprise in Zed's design — and the one easiest to miss without reading the code — is that **Zed does not run PTYs on the remote machine.** When the user opens a remote terminal, the PTY runs locally; ssh is the program inside it; ssh inside the PTY drops the user into a remote shell. Verified at `crates/remote/src/transport/ssh.rs:1768-1880` (`build_command_posix`): the command Zed builds is literally

```
ssh -q -t <destination> 'cd <working_dir> && exec env <ENV_KV...> <remote_shell> -l'
```

That command is passed to `alacritty_terminal::tty::new(...)` as the PTY's program (`crates/terminal/src/terminal.rs:568`). No remote PTY, no helper-side PTY engine, no ring buffer, no replay logic.

Consequences:

- **The remote server (`crates/remote_server/`) has zero PTY responsibilities.** Its job is editor features: file IO, LSP, search, tasks, debugger, Jupyter kernels, directory environment. Verified by reading the handler list at `crates/remote_server/src/headless_project.rs` — every handler is a structured editor operation, none is "spawn a PTY."
- **OSC sequence parsing is native.** Bytes flow into the local PTY from ssh; xterm's local OSC parser sees them inline, same code path as local terminals.
- **SSH drops kill the PTY and its scrollback.** This is the cost of the simplicity. Zed accepts it; Kolu should too.

## The unification primitives: `Fs` and `GitRepository` traits

Zed unifies local-and-remote not by threading an executor parameter through call sites, but by **hiding the substrate behind a trait** that both local and remote impls satisfy.

- **`Fs` trait** at `crates/fs/src/fs.rs:97` — 33 methods covering `create_dir`, `create_file`, `copy_file`, `rename`, `remove_dir`, `remove_file`, `trash`, `atomic_write`, `save`, `load`, `load_bytes`, `canonicalize`, `is_file`, `is_dir`, `metadata`, `read_link`, `read_dir` (streaming), `watch` (streaming), `open_repo` (returns `GitRepository`), `git_init`, `git_clone`, `git_config`, `is_case_sensitive`. Two concrete impls: `RealFs` and `FakeFs` (for tests).
- **`GitRepository` trait** at `crates/git/src/repository.rs:750` — ~64 methods covering `status`, `diff_tree`, `branches`, `change_branch`, `create_branch`, `worktrees`, `create_worktree`, `reset`, `checkout_files`, `show`, `load_commit`, `blame`, stashes, checkpoints, and more. Returns typed results (`Branch`, `GitStatus`, `TreeDiff`, `CommitDetails`), not strings.
- **`RemoteConnection` trait** at `crates/remote/src/remote_client.rs:1509` — abstracts transport. Methods include `start_proxy`, `build_command(CommandTemplate)`, `upload_directory`, `kill`, `connection_options`, `path_style`, `shell`, `has_wsl_interop`. Concrete impls: `SshConnection` (`transport/ssh.rs`), `DockerConnection`, `WslConnection`, `MockConnection` (for tests).

This is the right factoring **for Zed** because their git surface is editor-pressure (blame per buffer, status per keystroke, branch picker). The structured trait + libgit2 backend earns its keep. **For Kolu, this trait shape is over-engineered** — kolu-git's event-driven surface (branch chip, worktree create, status for review pane) is happy with `exec("git", …)` against the user's `git` binary. The lesson Kolu should take from Zed isn't "build a 30-method `Fs` trait"; it's "find one substrate-volatility seam, and put one abstraction there."

## The remote daemon: `headless_project`

`crates/remote_server/src/headless_project.rs` is the heart of Zed's remote design. It's a `HeadlessProject` struct (~1300 lines) that reuses Zed's `Project` model in headless mode. Same code, same provider abstractions, same internal events — just no UI attached.

The pattern Kolu should borrow:

> The remote daemon does not invent its own version of provider logic. It instantiates the same provider modules the controller would, and ships their events over the wire.

Concretely:

- `HeadlessProject::new` loads worktrees, git repos, LSP store, buffer store, etc. — the same constructors the controller-side `Project` calls.
- RPC handlers (`handle_add_worktree`, `handle_open_buffer_by_path`, `handle_find_search_candidates`, etc.) translate wire messages into operations on the in-process `Project`.
- Events flow out via the project's normal subscriber pattern; the wire layer wraps them as protobuf envelopes and sends them.

Verified handler list (the daemon's RPC surface):

| Handler | Purpose |
|---|---|
| `handle_add_worktree` / `handle_remove_worktree` / `handle_trust_worktrees` | Worktree lifecycle |
| `handle_open_buffer_by_path` / `handle_open_image_by_path` / `handle_open_new_buffer` | Buffer/file IO |
| `handle_download_file_by_path` | One-shot file fetch |
| `handle_toggle_lsp_logs` / `handle_open_server_settings` | LSP integration |
| `handle_spawn_kernel` / `handle_kill_kernel` | Jupyter kernel lifecycle (repl crate) |
| `handle_find_search_candidates` | Project-wide search |
| `handle_list_remote_directory` / `handle_get_path_metadata` | File-tree browsing |
| `handle_get_processes` | Process listing |
| `handle_get_directory_environment` | Env resolution for terminal/task spawning |
| `handle_ping` / `handle_shutdown_remote_server` | Health + lifecycle |

Notably absent: anything PTY-related. Zed's terminals are local-with-ssh-inside.

## Wire protocol: protobuf Envelope over length-prefixed stdio

Zed's wire protocol is small and elegant. Source files to read in order:

1. **`crates/remote/src/protocol.rs`** (76 lines) — framing only. 4-byte little-endian length prefix, then a `prost`-encoded `rpc::proto::Envelope`. `read_message` and `write_message` are the API.

2. **`crates/proto/proto/zed.proto`** (581 lines) — schema. The `Envelope` message has:
   ```
   message Envelope {
     uint32 id = 1;
     optional uint32 responding_to = 2;
     optional PeerId original_sender_id = 3;
     optional uint32 ack_id = 266;
     oneof payload {
       Hello hello = 4;
       Ack ack = 5;
       Error error = 6;
       Ping ping = 7;
       EndStream end_stream = 165;
       // ... ~350 more variants, one per RPC type
     }
   }
   ```

3. **`crates/rpc/src/peer.rs`** (1371 lines) — the `Peer` struct exposes six operations:
   - `send(receiver, msg)` (line 586) — fire-and-forget envelope.
   - `request(receiver, msg) -> T::Response` (line 405) — request/response; response carries `responding_to = original.id`.
   - `request_stream(receiver, msg) -> BoxStream<T::Response>` (line 489) — streaming request; one outbound, many inbound responses; ends when an `EndStream` payload arrives.
   - `forward_send` (line 605) and `forward_request` (line 422) — proxy a message between two connections (collaboration).
   - `respond(receipt, response)` (line 625) — server-side response to a request.

4. **`crates/rpc/src/proto_client.rs`** — client-side handler registry. `add_entity_message_handler`, `add_entity_request_handler`, `add_entity_stream_request_handler` register typed handlers per message variant.

The relevant patterns for a Kolu-style remote-terminal feature:

- **Subscriptions are streaming requests.** Client sends `SubscribeGitInfo { cwd }`; server replies with an unbounded stream of `GitInfoUpdate` envelopes. Cancelling = drop the receiver, server detects via `EndStream` round-trip.
- **One-shot commands are plain request/response.** `CreateWorktree { repo, name }` → `CreateWorktreeResponse`.
- **No explicit "subscribe / unsubscribe" lifecycle methods.** The stream lifetime IS the subscription lifetime.

## Wire-protocol trade-offs (for Kolu's pick)

Zed picked **protobuf over length-prefixed stdio** because:

1. Schema-versioned (`prost`'s field numbers are forward/backward compatible).
2. Binary-efficient — matters when shipping many buffer-change events per second.
3. Same protocol used between Zed clients and collab server, so reuse.
4. `rpc::proto::Envelope`'s `oneof payload` cleanly types every message variant.

For Kolu, the alternatives:

| Option | Pros | Cons | Pick for Kolu? |
|---|---|---|---|
| **Protobuf** (Zed's choice) | Efficient, schema-versioned, mature tooling, `EndStream` pattern is clean | Codegen step; TS ecosystem doesn't lean here | No — codegen tax not worth it for our message volume |
| **NDJSON + Zod with explicit envelope discrim** | TS-native, no codegen, debuggable via `cat`, schemas double as runtime validators | Hand-roll subscription/`EndStream` semantics | **Yes** — right fit for Kolu's TS-native context |
| **MessagePack + Zod** | Compact (50-70% of JSON), TS support reasonable | Hand-roll subscription tracking; binary debugging | No — JSON compactness rarely the bottleneck |
| **JSON-RPC 2.0** | Standard, has notification pattern (one-way) | "Notifications" aren't subscriptions; still need to layer subscription semantics | No — close but not quite |

The pick is **NDJSON + Zod with a Zed-shaped envelope discriminator**. Concretely, every line is a JSON object matching one of:

```ts
{ kind: "request",   id: number, method: string, params: ... }
{ kind: "response",  respondingTo: number, result: ... }       // success
{ kind: "error",     respondingTo: number, error: ... }
{ kind: "event",     respondingTo: number, payload: ... }      // streaming response
{ kind: "endStream", respondingTo: number }                    // marks stream end
{ kind: "ping" }                                               // keepalive
```

This is structurally Zed's `Envelope` minus the protobuf encoding. Same patterns (request/response, request_stream + EndStream, ping), same lifecycle semantics, just human-readable on the wire.

## Server binary deployment

Zed's deployment story is documented at `docs/src/remote-development.md` and implemented at `crates/remote/src/remote_client.rs:785` (`ensure_server_binary`):

- **Default**: remote host downloads a prebuilt binary from `zed.dev` directly (using the remote's network). Platform/arch detected via `uname -sm` first.
- **`upload_binary_over_ssh: true` setting**: controller pulls the binary down locally and `scp`s it to the remote. For air-gapped remotes.
- **Version negotiation**: server binary version must match client; mismatch triggers re-download.

For Kolu — Nix-only deployment — the equivalent is `nix copy --to ssh-ng://<alias>` of the controller's exact `kolu-remote-server` closure. Same-arch fast path via Nix substituters; cross-arch via "copy the .drv and realise on remote" (`nix copy --derivation` + `nix-store --realise`). No HTTP download path, no env-override escape hatch — Nix is the deployment contract.

Verified location: `ensure_server_binary` is at `crates/remote/src/transport/ssh.rs:785` (not in `remote_client.rs` as I initially cited).

## Multi-transport pattern

Zed's `RemoteConnection` trait has four implementations (`crates/remote/src/transport/`):

- **`ssh.rs`** — OpenSSH-based, the default.
- **`docker.rs`** — `docker exec` into a container.
- **`wsl.rs`** — `wsl.exe` shell-out for Windows hosts.
- **`mock.rs`** — in-process for tests.

Worth borrowing: shape Kolu's transport seam so a future Docker/WSL backend slots in without rewriting consumers. The trait surface to mirror is `start_proxy`, `build_command(CommandTemplate)`, `connection_options`, `path_style`, `shell`. Don't over-engineer this for Kolu's V1 (SSH-only), but leave the seam — one trait, one impl initially.

## SSH ControlMaster multiplexing

Verified from `crates/remote/src/transport/ssh.rs:166-168`: Zed actually uses `ControlMaster=yes` + `ControlPersist=no`. **Not** `auto`/`10m` as I initially recorded. The difference matters:

- `ControlMaster=yes`: Zed launches the master ssh process itself (rather than letting OpenSSH auto-promote a client to master).
- `ControlPersist=no`: the master exits when Zed kills it (rather than persisting for N minutes after the last client disconnects).
- Zed manages the master process lifecycle via `kill_on_drop` — when the connection's `Drop` runs, the master gets killed.

The TCP-sharing benefit is the same as `auto`/`Npersist`: multiple Zed child processes (terminal PTY, metadata RPC, file IO) share one TCP connection to the host. The difference is who owns the master's lifetime — Zed (yes+no+kill_on_drop) or OpenSSH (auto+Npersist).

Kolu's choice: either approach works for the two-channel (PTY + metadata RPC) use case. The `auto + ControlPersist=10m` shape is simpler to set up (Kolu doesn't manage the master). The `yes + no + kill_on_drop` shape gives precise lifecycle control. For V1, `auto + ControlPersist=10m` is sufficient.

## Subscription dedup / activation registry

When five Zed clients open the same remote project, the headless server doesn't run five copies of the worktree watcher — it runs one and fans out events to all subscribers. The dedup logic lives inside the various `*Store` types (`buffer_store.rs`, `worktree_store.rs`, `lsp_store.rs`, `git_store.rs` — all in `crates/project/src/`). Each store owns the underlying subscription and maintains a `Vec<ProjectClient>` of subscribers.

For Kolu, the equivalent: the kolu-remote-server should dedupe identical subscriptions across terminals on the same host. Two terminals subscribing to git info for the same `cwd` → one underlying `subscribeGitInfo` call, two RPC stream subscribers. This is the same "activation registry" idea our earlier design floated, but **simpler because there's no executor identity to discriminate** — the remote daemon is the only "executor" from its own perspective.

Verified: the four `*Store` files exist (`buffer_store.rs`, `worktree_store.rs`, `lsp_store.rs`, `git_store.rs` in `crates/project/src/`), and each maintains subscriber lists (typed as `Vec<async_channel::Sender<…>>` — e.g. `git_store.rs:365` — not the made-up `Vec<ProjectClient>` I initially wrote).

## Foreground-process tracking under local-PTY-+-ssh-inside

A wrinkle the architecture forces: under Zed's approach, the local PTY's foreground process is `ssh`, not the agent process running on the remote. Anything that needs to know "is claude-code currently foregrounded in this terminal?" needs help from the remote side.

Zed doesn't have an analogous feature (agent-CLI detection) so there's no direct precedent. The shape of the solution:

1. **Controller tracks the SSH session's PID** (its own local node-pty child).
2. **Controller tells the remote daemon "terminal T's ssh session on you has PID X"** (passed in the subscription request).
3. **Remote daemon walks `/proc/X` to find the shell child**, then polls `/proc/$shellPid/stat` field 8 (`tpgid`) for the foreground process group.
4. **Remote daemon resolves the pgid to a process name** via `/proc/$tpgid/comm`.
5. Emits `foregroundChange` events when the value flips. Same shape as today's local foreground tracking, just sourced remotely.

macOS doesn't have `/proc` — equivalent there is `proc_listpids` + `proc_pidinfo`. Native-binding territory. Defer until Kolu actually targets macOS-as-remote (Linux-as-remote is the common case).

## What's worth borrowing from Zed (summary)

| Pattern | Adopt for Kolu? | Notes |
|---|---|---|
| Local PTY + `ssh -t <host> '...'` as the program for remote terminals | **Yes** — substantial simplification (no remote PTY engine) |
| Headless daemon runs the same provider code as the controller | **Yes** — Kolu's run-providers-on-remote architecture |
| Subscriptions as streaming RPCs (one outbound, many inbound, `EndStream` to close) | **Yes** — mirrored in Kolu's NDJSON envelope shape |
| Protobuf wire encoding | **No** — NDJSON+Zod fits TS-native context |
| Multi-transport (SSH / Docker / WSL / mock) behind one trait | **Aspire to** — leave the seam, ship SSH only initially |
| ControlMaster multiplexing | **Yes** — explicitly set on every ssh invocation |
| `nix copy --to ssh-ng://...` (controller pushes closure) | **Yes** — Kolu's deployment contract |
| Server downloads from `zed.dev` HTTP | **No** — Kolu is Nix-only |
| Structured `Fs` trait with 30+ methods | **No** — Kolu's IO surface is narrower; `exec("git", …)` suffices |
| Structured `GitRepository` trait + libgit2 backend | **No** — Kolu's git pressure doesn't justify it |
| `CommandTemplate { program, args, env }` returned by transport | **Yes** — clean separation between "build the ssh invocation" and "what to do with it" |

## Anti-patterns observed (things to NOT borrow)

- **Project model on both sides.** Zed reuses `Project` headless because their UI revolves around it. Kolu's terminal-first product doesn't have a `Project` equivalent; trying to invent one would be over-engineering.
- **Per-connection collaboration plumbing** (`PeerId`, room management, ack flow control). Zed's RPC layer is shared with their collab server, which supports multi-user editing. Kolu's remote-terminal is single-user; the collab plumbing is dead weight if copied verbatim.
- **Protobuf field-number reservations / migrations.** Zed's `zed.proto` has decades of accumulated reserved numbers and "current max" comments because they evolve the schema in production. Kolu's NDJSON-with-Zod approach handles this via Zod's `optional` + `default` instead.

## Quick-reference file paths inside `/tmp/zed`

| File | Purpose |
|---|---|
| `crates/remote/src/protocol.rs` | Wire framing (length-prefixed protobuf) |
| `crates/proto/proto/zed.proto` | `Envelope` schema + payload variants |
| `crates/rpc/src/peer.rs` | RPC operations (`request`, `request_stream`, `send`, `respond`) |
| `crates/rpc/src/proto_client.rs` | Typed handler registration |
| `crates/remote/src/remote_client.rs` | `RemoteClient` + `RemoteConnection` trait |
| `crates/remote/src/transport/{ssh,docker,wsl,mock}.rs` | Transport impls |
| `crates/remote/src/transport/ssh.rs:1768` | `build_command_posix` — the ssh-as-PTY-program command |
| `crates/remote_server/src/main.rs` | Server binary entry |
| `crates/remote_server/src/server.rs` | Run / proxy / version modes |
| `crates/remote_server/src/headless_project.rs` | RPC handlers + headless `Project` |
| `crates/fs/src/fs.rs:97` | `Fs` trait — Zed's IO abstraction |
| `crates/git/src/repository.rs:750` | `GitRepository` trait — Zed's git abstraction |
| `crates/terminal/src/terminal.rs:568` | Local PTY spawn via `alacritty_terminal::tty::new` |
| `crates/project/src/terminals.rs:609` | `create_remote_shell` — builds ssh command for terminal PTY |
| `docs/src/remote-development.md` | User-facing docs (settings, supported platforms) |

Re-clone with: `git clone --depth 1 --filter=blob:none https://github.com/zed-industries/zed.git /tmp/zed`.
