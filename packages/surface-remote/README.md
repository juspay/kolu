# `@kolu/surface-remote`

**Run a typed [`@kolu/surface`](../surface/) agent on a remote machine over `ssh`. The package handles provisioning (ship a Nix derivation, realise it on the target), the long-lived ssh subprocess (with ref-counting, reconnect, exponential backoff), and the reactive state cell that lets you observe link lifecycle in the same `useCell` shape browsers consume.**

You bring the surface contract (your `defineSurface(…)` schema) and the agent binary's `.drv`. The package gives you a typed RPC client over stdio, plus a state machine that survives transient drops and respawns the agent through a fresh ssh subprocess on the other side.

## When to reach for it

You want a Node parent server to talk to an agent process on another host as if it were local — same `useCell` / `useCollection` / `useStream` shape the browser uses, just with a Node-process boundary in the middle instead of a WebSocket. The headline use case is **kolu's `RemoteTerminalBackend`**: the parent's terminal surface forwards reads to a kolu-agent running on the user's remote dev box. The same shape works for any "read sensors / mutate state / observe events on host X from host Y" problem — process monitor, log tailer, GPU stats, build runner, etc.

The reference consumer is [`packages/surface/example/remote-process-monitor/`](../surface/example/remote-process-monitor/) — a three-tier `htop`-style live process monitor that exercises every primitive in this package end-to-end.

## What it gives you

```ts
import {
  makeSession, sshConnector,
  type Session, type AgentClient,
} from "@kolu/surface-remote";
import { contract } from "./your-surface";  // your typed @kolu/surface contract

// A "session over ssh" is `makeSession` (the transport-agnostic reconnect/backoff/
// give-up/watchdog loop) plugged with `sshConnector` (the ssh transport). You OWN the
// session you get — there is no shared pool; key your own map and tear it down yourself.
const session: Session<AgentClient<typeof contract>> = makeSession({
  connectOnce: sshConnector<typeof contract>({
    host: "alice@bob.example",                 // any ssh target; "localhost" short-circuits
    resolveDrvPath: () =>                       // resolve the agent's .drv for the *target*
      Promise.resolve(process.env.MY_AGENT_DRV!),//   arch; called inside each spawn (see below)
    binary: "my-agent",                        // exe name inside the realised closure
  }),
});

// Subscribe to lifecycle state (snapshot-then-delta).
session.onState((s) => console.log(s.connection));
//   "copying"   → "connecting" → "connected"
//   on drop:    → "disconnected" → "copying" → … (exp backoff, capped at 60s)
//   network drop (unreachable host): retries forever; remote rejection
//     (e.g. trusted-users): gives up into terminal "failed" after N. See
//     `s.failureCause`. `recheck()` force-re-probes after a laptop wake.

// Pin the session for the parent's lifetime; obtain the typed client.
const client = await session.pin();
const sys = client.system.get({});           // typed oRPC — same shape your browser uses
```

## What it's NOT

- **Not a transport.** That's [`@kolu/surface/links/stdio`](../surface/src/links/stdio.ts). This package sits *on top of* the stdio link and adds: process supervision (spawn/respawn ssh), `.drv` provisioning (the Nix bit), and a reactive state cell for the connection's own lifecycle.
- **Not a Nix utility.** `provisionAgent` is purposely minimal — `nix copy --derivation`, then `ssh $host nix-store --realise`, then pin the output behind a per-agent GC root, then return the resulting path (an already-provisioned host short-circuits all three with a single realise-probe — see [Why Nix](#why-nix-locked-in)). If you want richer flake handling (e.g. resolve a flake ref to a `.drv`), do it inside the `resolveDrvPath` callback you pass.
- **Not opinionated about UI.** The package returns a typed RPC client. Mirroring its streams into your parent server's local surface (so the browser can consume them) is the consumer's job. See the [`remote-process-monitor` example](../surface/example/remote-process-monitor/src/server/router.ts) for the canonical bridge pattern. **One exception graduated:** surfacing the *connection health itself* to the browser is common to every consumer, so the package ships a composable, browser-safe `connection` cell from [`@kolu/surface-remote/connection`](./src/connection.ts). The public composition path is **`mirroredSurface(base)`** — it adds the gate-closed, get-only `connection` cell at the mirror seam and *reserves* the `connection` name (it throws on a base that already declares one), so you never hand-spread it into `cells` and bypass that collision guard. `connectionCell` / `ConnectionInfoSchema` / the gate-closed `DEFAULT_CONNECTION` are exported as the *fragment* `mirroredSurface` owns (read them to seed a store or assert the shape), not as a cell to spread yourself. The node-side pump [`pipeSessionStateToCell(session, set)`](./src/connectionPipe.ts) drives the cell off `session.onState` (and `pumpRemoteSurface` wires it for you when the mirrored surface carries `connection`). The *rendering* stays yours; the cell shape, the gate-closed default, and the `onState → cell` projection are shared so two consumers can't drift.

## Why Nix (locked-in)

Cross-arch deployment is the load-bearing problem this package solves. Parent on darwin, target on linux — or vice versa. A locally-built closure has the parent's CPU architecture baked into its binaries; `nix copy` can't smuggle it across.

The `.drv` ships **build instructions** (platform-neutral) rather than build outputs. The remote realises the derivation on its own architecture, producing target-arch-correct binaries.

```
parent: nix eval --raw .#packages.<remote-system>.<agent>.drvPath
        └── caller's responsibility — `resolveSystem(host)` gives <remote-system>
parent: nix copy --derivation --to ssh-ng://$host $drvPath
remote: nix-store --realise $drvPath  →  /nix/store/...-agent
remote: nix-store --realise $out --add-root <link> --indirect  (GC-pin)
parent: ssh $host $agentPath/bin/<binary> --stdio
```

The pin step is what keeps a `nix-collect-garbage` on the target from
deleting the agent out from under a live session (or forcing a rebuild on
the next reconnect). The root is one fixed symlink per agent — keyed on the
`.drv` name — so each realise moves it to the newest output and the previous
hash becomes GC-eligible, exactly like `nix build`'s `result` link. It's
best-effort: if the root can't be written, the agent still runs unpinned.

**Warm fast-path.** On an already-provisioned host the whole sequence collapses to one ssh. `provisionAgent` first runs `nix-store --realise $drvPath --add-root <link> --indirect`, which on a host that already holds the closure is an instant no-op that both confirms it's present *and* refreshes the GC root — so the redundant `nix copy` (the wasteful "copying 0 paths" step), plus the separate realise/pin a warm host would otherwise re-pay on every dial, is skipped. On a miss it fast-fails and falls through to the full `nix copy → realise → pin` above; the fall-through's pin is best-effort, so even an unwritable root degrades to *works, unpinned* rather than a hard failure. Remote-only — localhost never copies anyway (the `.drv` is already in its store).

**Connection multiplexing.** The surviving ssh round-trips of a warm dial — the arch probe (`resolveSystem`), the realise-probe provision check, and the agent dial — used to each pay their own ~5s ssh handshake because nothing reused the connection. They now share **one** ssh master via `ControlMaster=auto` / `ControlPersist`: the first op opens it, the rest ride it as near-instant channels (and `nix copy`'s own ssh fork rides it too, through `NIX_SSHOPTS`). It needs **no `~/.ssh/config` change** — the control opts ride the same single-source-of-truth render as the dead-peer keepalive — and the control socket is a **kolu-private** path (never `~/.ssh`): `$XDG_RUNTIME_DIR/kolu-ssh/%C` on systemd Linux, else the per-user `/tmp/kolu-ssh-$UID/%C` fallback (same `getRuntimeSocketPath` convention as the pty-host socket). It's addressed by ssh's `%C` token to stay short and per-host. Multiplexing is purely additive: if the control dir can't be made owner-only the opts silently drop and ssh connects un-multiplexed, never a failure. Lifecycle is delegated to ssh's own `auto` — a stale master (unclean death) just costs one un-multiplexed dial, which then re-masters; there is deliberately no `ssh -O exit` teardown, which would defeat the *cross-invocation* warmth `ControlPersist` exists to provide (a second `kaval-tui` within minutes reuses the still-warm master).

**Nix is the contract, not the implementation.** No tarball, Docker, or prebuilt-binary fallback exists or will. The whole point of this package is "use Nix for cross-arch deployment of typed stdio agents"; consumers that don't want Nix should pick a different transport layer.

Remote-side requirement: the parent's user must be in `trusted-users` in the remote's `nix.conf` so the daemon accepts the unsigned closure. Without that, `nix copy` rejects.

## The pieces

| Export | Role |
|---|---|
| `makeSession<C>(opts)` | **The reconnect-mirror session appliance.** The transport-agnostic ELECTRICITY, extracted once: ref-count (`pin`), exponential backoff, bounded give-up on *remote* faults, the connect + liveness watchdogs, `reconnect`/`recheck`, the snapshot-then-delta state cell, and the reserved `system.identity` poll. It owns none of the transport — you hand it a `connectOnce` {@link `Connector`} (and an optional `admit` supervision hook). Returns the loose {@link `Session`} role (a plain object of closures — no wrapper class), so a daemon flavour is derived by object-spreading extra members onto it. You OWN each session (no shared pool); key your own map and `destroy()` them yourself. |
| `sshConnector<C>(opts)` | **The ssh transport plug** for `makeSession`. Per dial it resolves the agent's `.drv` (typically an ssh arch probe via `resolveSystem`), Nix-provisions the closure onto the host, spawns `ssh <host> <binary> --stdio`, and wires the stdio byte channel to a contract-typed `AgentClient<C>` — handing the loop ONE `Connection`. A resolve/provision failure REJECTS with a classified `ConnectError` (`network` = retry forever, `remote` = bounded → terminal). This is the kept primitive; "a session over ssh" is just `makeSession({ connectOnce: sshConnector(opts) })`. |
| `Connector<Client>` / `Connection<Client>` / `ConnectContext` / `ConnectError` | The transport SEAM. A `Connector` dials once and returns a `Connection` (`{ client, closed, isAlive, teardown }`) or rejects with a classified `ConnectError`; `makeSession` owns everything after. Supply your own connector for a non-ssh transport (kolu-server's local padi arm plugs a unix-socket endpoint connector), or `sshConnector` for the ssh case. `surfaceLiveProbe(client)` is the default `isAlive` (the reserved `system.live` round-trip). |
| `Admit<Client>` / `AdmitVerdict` | The optional SUPERVISION hook run once per dial after the transport is up — a daemon session's convergence (contract-skew / build decision + drain). Returns `adopt` \| `refuse(state)` \| `replaced(reason)`. Omit it and every connection is adopted (the plain ssh/agent case). |
| `measureClockOffset(client, log?)` | Sample a bound daemon's wall-clock offset (ms) vs this process, RTT-halved over a frozen control-core `clockNow` — call once per admit/connect (offset-at-hello IS the contract; no continuous drift correction). The value a `DaemonSession.clockOffset()` stamps, which `serveHostMap`'s projection folds into `EntryStatus.connected` so two hosts render on two clocks without comparing them. A probe failure is never swallowed to a fabricated/absent offset: it's logged via the optional `(line: string) => void` sink and RETHROWN, so the caller's connector/admit hook (already running inside `makeSession`'s `attempt()`) turns it into an honest `disconnected` + reconnect. |
| `dialAgentOnce<C>(opts)` | **One-shot CLI dial.** The composition every `--host` CLI needs but no single export owned: parse + validate the baked `{ system → drv }` env map (fail-fast, *before* any session), construct an unshared `makeSession` over `sshConnector`, then `pin → probe → markConnected → return { client, dispose }` with the link already proven live. Caller brings only its volatile values — `binary`, the env-var name + value, a `drvNoun` for errors, the remote agent's exact stderr `fatalPrefix` (so a remote fatal surfaces verbatim; differs from `drvNoun` when the front writes e.g. `kaval --stdio:`), and a one-RPC `probe` closure. Independent by design: a one-shot dial's `dispose()` tears down only its own session. Used by `kaval-tui --host` and `pulam-tui --host`. |
| `provisionAgent({ host, drvPath, onProgress })` | Ship the `.drv` to the host (skipped for localhost), `nix-store --realise` it there, pin the output behind a per-agent GC root (`agentGcRootPath`), and return the realised output path. An already-provisioned remote skips the copy via a single realise-probe (the *warm fast-path* in [Why Nix](#why-nix-locked-in)). Progress lines forwarded to `onProgress`. |
| `makeClientCursor(session)` | A stateful cursor over the session's spawn lifecycle: `cursor.next()` blocks until the session produces a *fresh* `AgentClient<C>` (post-reconnect). Owns the spawn-identity comparison so a consumer's reconnect-loop can't busy-spin. |
| `pumpRemoteSurface(session, makeSink)` | **The reconnect-mirror loop, packaged.** Pins the session, loops over each successive client (`makeClientCursor`), and runs ONE `mirrorRemoteSurface` per spawn — folding the agent's frames into the caller's `makeSink` (built per spawn, so per-client state resets on reconnect) until the link dies, then awaits the next spawn. Optional `liveProcedures` / `liveClient` holders re-serve the mirror's procedures + input-parameterized streams; the optional `onLinkDown` hook fires on each link death (after the holders clear), the cue to drop any per-link local fold (e.g. a re-serve's awareness cache) so the next spawn rebuilds from the fresh snapshot rather than inherit a stale row across the reconnect. The consume-side companion to `makeSession` — what every parent that re-serves a remote surface needs. |
| `buildRemotePool({ buildEntry })` | **The N-host fan-out.** A keyed `Map<host, { session, handler }>` a `?host=` upgrade dispatcher reads, with `add`/`remove`/`reconnect`/`recheckAll` + per-host socket eviction. The app supplies `buildEntry(host) → { session, handler }` (provisioning + its oRPC handler) and an optional `persist` hook; the registry (`RemotePool<S, H>`, widened to carry the fleet verbs as `PoolControls` when `controls` is supplied) is generic over the handler type (no `@orpc/server/ws` dep). |
| `serveHostMap(map, pool, { linkFor })` / `MembershipPool<S>` | **Adapt a `buildRemotePool` pool into a [`@kolu/surface-map`](../surface-map/) `MapRegistry`.** Fuses the pool's membership `subscribe` with each member session's own `onState`, so the map's `entries` republish on a membership change AND a per-session status transition (`copying`/`warming` → `connected` → `failed`), not just membership. Projects each `SessionState` — folding in the session's measured `clockOffset()` — into the map's `EntryConnectionState`, and caches each host's `linkFor(host, session)` result (built once per host, evicted on removal). Belts a non-provisioning session (`session.provisions === false`, juspay/kolu#1716) against ever legitimately projecting `copying` — a wrong widening throws loud instead of painting a lying "warming" chip. `pool` only needs `MembershipPool<S>`, the `hosts`/`has`/`getSession`/`subscribe` slice of a `RemotePool`. |
| `LiveSpawnHolder<T>` / `ObservableHolder<T>` (`observableHolder()`) | A `{ current: T \| null }` cell `pumpRemoteSurface` sets on each connect and clears on link death — the receptacle a re-serve forwards through (procedure stubs or the live client), so a forward in the gap between a dropped link and the next spawn fails honestly rather than relaying into a dead client. `ObservableHolder` adds `whenChanged(signal)` so a held-open forwarder can `await` the next spawn instead of polling. |
| `reServeSurface({ source, policy, session })` | **The policy-driven re-serve, packaged.** Wires the whole three-hop re-serve for ONE binding — `mirroredSurface(source)` + `implementSurface` deps derived from the per-member forwarding `policy`, owning `pumpRemoteSurface` internally — and returns `{ surface, router, done }`. VALUE members (cells / collections / value pulses) are held open and REPLAYED across an upstream drop (no healthy-but-empty flash); DELTA members (byte / liveness streams) FAIL THROUGH (an upstream drop ends the downstream stream so the client re-subscribes end-to-end and a snapshot only ever leads a FRESH stream). Each call mints its OWN store set + router, so a parent fronting N hosts calls it once per host (through `buildRemotePool`'s `buildEntry`, keyed by the connection's declared host) — **per-binding scope, no module-level router shared across connections.** Generalizes pulam-web's retired `buildReServe`; its consumers are its own tests + the paired drishti run. |
| `relayHoldOpenStream(policy, member, holder, select)` · `relayFailThroughStream(policy, member, holder, select)` | The two per-subscriber input-keyed stream relays — the **type-guarded, direct-use** API (the `reServeSurface` assembly calls their unguarded cores after a runtime policy branch, since its member keys are `string`). `relayHoldOpenStream` HOLDS the downstream open across a respawn (rebinds to the next spawn — for a `value` pulse / event); `relayFailThroughStream` forwards the current spawn's stream 1:1, propagating its clean end AND its error, and NEVER rebinds (for a `delta` byte stream). At a direct call site `member` is type-constrained to the matching policy class, so **holding open a byte stream is a compile error** (pinned by `relayStream.test`'s `_typeGuards`). |
| `RelayPolicy`, `ValueMembers<P>`, `DeltaMembers<P>` | The forwarding-policy type — a `Record<member, "value" \| "delta">` a surface's authored policy satisfies (e.g. padi's `PADI_FORWARDING_POLICY`, `... as const satisfies`) — plus the two mapped types that derive its `value` / `delta` member sets. The compile-time guard behind the relays; the re-serve reads the SAME classification W1 pinned, with no second declaration to drift. |
| `buildAgentCommand({ host, agentPath, binary })` | Compute the spawn argv for an agent binary on a given host. Used internally; exported for consumers that need to invoke the agent directly (e.g. one-shot subprocess tests). The argv ends ssh's option parsing with `--` before the host, so an attacker-influenced `host` (`-oProxyCommand=…`) can never be read by ssh as an *option* — it is always a destination. |
| `resolveSystem(host)` | Ask `host`'s own Nix for `builtins.currentSystem` (`nix-instantiate --eval`, locally for `isLocalHost`, over `ssh` otherwise) and return the nix-system string. No `uname` table to maintain — the host's Nix is the source of truth, and it's already reachable since `provisionAgent` shells `nix-store` on the same PATH. Pairs with a per-system `.drv` map the caller builds at its own build time. **Memoized per host for the process** (a host's nix-system is stable), so repeat dials don't re-probe; a *failed* probe isn't cached, so a transient-unreachable host re-probes on the next dial. |
| `runCapture(cmd, args, onProgress)`, `runProgress(cmd, args, onProgress)` | Spawn-and-await helpers with consistent close-event-flush semantics. Used internally by `provisionAgent` and `resolveSystem`; exported so consumers can avoid re-rolling the same event-wiring dance. |
| `isLocalHost(host)`, `forEachLine(chunk, cb)` | Small utilities shared by `nixCopy` and `sshConnector`. |

## Lifecycle invariants

- **Snapshot-then-delta on `onState`**: a listener attached at any point sees the current state synchronously before any subsequent transitions. Matches the contract `@kolu/surface`'s `useCell` consumers expect.
- **`pin()`**: the parent-lifetime intent — bumps `refCount` unconditionally so the session keeps trying to reconnect even if the first spawn fails, and resolves with the first client. A parent pins once for the session's life; `destroy()` drops it regardless of the count (server shutdown).
- **Reconnect terminates only for *remote* faults**: each failure carries a `failureCause` (`"network"` | `"remote"`). A `"remote"` fault — the host answered but rejected the closure (e.g. the parent's user isn't in `trusted-users`) — is bounded by `MAX_CONSECUTIVE_FAILURES` (currently 5); after that the session surfaces the terminal `"failed"` state with the last error, so a misconfigured target fails loudly instead of spamming forever. A `"network"` fault — the host was unreachable (asleep, roaming between Wi-Fi networks, VPN down) — is **never** terminal: the session keeps retrying at the capped backoff indefinitely, so a laptop that closes its lid at home and reopens at a café reconnects on its own with no manual intervention.
- **`recheck()` vs `reconnect()`**: `reconnect()` is the manual "Reconnect" button — it re-arms a `"failed"`/idle session and deliberately won't disturb a live link. `recheck()` is the wake / network-change companion: it force-cycles *whatever* is there, including a `"connected"` link, because after a sleep that link is often stale (the far end dropped the socket but the local ssh child won't notice until its keepalive fails ~30s later). A long-running parent calls `recheck()` on every session when it observes the machine wake or regain connectivity.
- **Periodic liveness watchdog (default-on)**: while `connected`, the session probes the framework-reserved `system.live` round-trip (`@kolu/surface/liveness`) on an interval (default 15s / 10s timeout — the **shared `DEFAULT_HEARTBEAT_*` constants** from `@kolu/surface/heartbeat`, so the cadence is pinned to the browser leg by structure, not a comment). A probe that **times out** means the remote is *silently wedged* — the process is alive and the stdio link is open (so no EOF fires, and ssh keepalive won't notice for ~30s), but the agent has stopped answering — so the watchdog force-cycles the child through `recheck()`'s path. This catches exactly the case `recheck()` (which needs an external wake/network signal) and the child-exit handler (which needs an actual EOF) both miss. A probe **rejection** still counts as alive (the round-trip completed — an agent too old to answer `system.live` simply degrades to the prior no-watchdog behaviour), so only a true non-answer cycles. It is built on the SAME lifted `@kolu/surface/heartbeat` watchdog primitive the browser leg wraps — one algorithm, two legs, parameterized only on the live gate (`connected` here, `readyState === OPEN` in the browser) and the on-stale action (`recheck()` here, `ws.reconnect()` in the browser). Born at the first `markConnected` (so it never probes before the first RPC) and gated on `connected` (so the minutes-long copying/connecting window is never disturbed); opt out with `liveness: false`.
- **Pump-loop pattern**: the stdio link doesn't auto-reconnect mid-stream (the streams die with the agent process). A consumer that re-serves a remote `@kolu/surface` should reach for **`pumpRemoteSurface`** — it owns the whole loop (pin → `makeClientCursor` → one `mirrorRemoteSurface` per spawn → await the next), so the only app code is the per-spawn `makeSink`:

  ```ts
  await pumpRemoteSurface({
    source: surface,                          // the surface to mirror + re-serve
    session,
    makeSink: () => ({                        // built per spawn — per-client state resets
      cells: { version: (v) => fragment.ctx.cells.version.set(v) },
      collections: { awareness: { upsert, remove } },
    }),
    liveProcedures,                           // optional: forward fs.*/git.* procedures
  });
  ```

  For the raw loop (when you're not mirroring a whole surface — pumping arbitrary streams by hand), drive `makeClientCursor` directly:

  ```ts
  const cursor = makeClientCursor(session);
  while (!session.isDestroyed()) {
    const client = await cursor.next();
    await Promise.allSettled([pumpSystem(client), pumpMetrics(client)]);
  }
  ```

  When the link dies, the pumps' `for await` loops settle, the loop re-enters, and `cursor.next()` blocks until the session's `scheduleReconnect` produces a new client.

- **Fan out over N hosts**: a parent that dials *many* hosts (a browser fleet view) keeps them in `buildRemotePool` — one `{ session, handler }` per host, with `add`/`remove`/`reconnect`/`recheckAll` + socket eviction — and dispatches a `?host=<id>` WebSocket upgrade to the right handler. Each host's `buildEntry` wires `makeSession({ connectOnce: sshConnector(...) })` + a `pumpRemoteSurface`-fed re-serve + its oRPC handler. The two consumers today are [`drishti`](https://github.com/srid/drishti)'s process monitor and `@kolu/pulam-web`'s terminal fleet — both consume one shared copy rather than re-rolling the loop + registry. A parent that fronts a keyed [`@kolu/surface-map`](../surface-map/) (rather than dispatching raw upgrades itself) reaches for **`serveHostMap`** over the same pool instead of hand-rolling the membership/status fusion — see the table above.

- **Policy-driven re-serve (per-binding)**: when the source surface classifies each member with a forwarding **`policy`** (`value` = hold-open vs `delta` = fail-through), a re-serve reaches for **`reServeSurface`** instead of hand-wiring `implementSurface` deps + the pump per member. It routes each member by policy — value members held open and replayed across an upstream drop, delta byte streams failed through — and owns the pump, returning `{ surface, router, done }`. Fanning out is then `buildEntry(host) → reServeSurface(...)`: **one store set + router per bound host** (keyed by the connection's declared host), replacing a single module-level router shared by every connection. The assembly routes each member by reading its policy at **runtime** (`requirePolicy`) — a byte stream can't reach the hold-open path — while the direct-use relays make the same split a **compile error**; W1's set-equality contract test pins which members are `delta`. A cell READS from the mirror; a cell WRITE throws (the re-serve is read-only until W2.2 forwards writes), and a collection's departed-while-down keys are reconciled on the fresh snapshot (no stale rows, no empty flash). (`reServeSurface` generalizes pulam-web's retired per-host `buildReServe` + `forwardInputStream` into the shared stack, adding the per-member policy the old code lacked and correcting the hold-open forwarder to fail-through for byte streams.)

## Computing `drvPath` for the target

> **One-shot CLI?** Reach for `dialAgentOnce` instead of hand-rolling any of
> this. It centralizes the env-map parse + `resolveSystem` lookup + the
> `pin → probe → markConnected → dispose` lifecycle for the `--host` shape:
>
> ```ts
> const { client, dispose } = await dialAgentOnce<typeof contract>({
>   host,
>   binary: "my-agent",
>   envVar: "MY_AGENT_DRVS_JSON",
>   agentDrvsJson: process.env.MY_AGENT_DRVS_JSON,
>   drvNoun: "my-agent",
>   // EXACT stderr prefix the remote agent writes before its fatal line — the
>   // dial surfaces the block from the last line carrying it through end-of-
>   // stderr as the failure reason. Often differs from `drvNoun` (kaval's
>   // `--stdio` front writes `kaval --stdio:`, not `kaval:`).
>   fatalPrefix: "my-agent:",
>   // No `probe` needed: the dial defaults to the framework-reserved `system.live`
>   // round-trip (every `defineSurface` agent answers it — the same receptacle the
>   // periodic watchdog uses), so an agent is provable without nominating a verb.
>   // Override `probe` ONLY for a protocol assertion beyond liveness (e.g.
>   // pulam-tui asserts `c.surface.version.get({})` yields a first frame).
> });
> ```
>
> The manual recipe below is for **long-lived** consumers that want the
> session's `onState`/`markConnected` seam directly (e.g. a parent server
> mirroring streams into its own surface).

The package solves the probe half of this — `resolveSystem(host)` asks the host's own Nix for `builtins.currentSystem` (locally or over `ssh`) and returns the nix-system string. The caller owns the policy of mapping that system to a derivation path; the typical shape is a JSON map baked at build time and looked up at runtime:

```ts
import { resolveSystem, makeSession, sshConnector } from "@kolu/surface-remote";

// drvBySystem usually comes from a build-time env var or flake attr:
//   { "x86_64-linux": "/nix/store/…-my-agent.drv",
//     "aarch64-linux": "/nix/store/…-my-agent.drv",
//     "aarch64-darwin": "/nix/store/…-my-agent.drv" }
const drvBySystem: Record<string, string> = JSON.parse(
  process.env.MY_AGENT_DRVS_JSON ?? "{}",
);

async function resolveDrv(host: string): Promise<string> {
  const sys = await resolveSystem(host);
  const drv = drvBySystem[sys];
  if (!drv) {
    throw new Error(`${host}: no .drv baked for ${sys}`);
  }
  return drv;
}

// Pass the probe as `resolveDrvPath` — do NOT `await resolveDrv(host)` at
// the call site. Eager resolution runs the ssh probe *before* the session
// exists, so an unreachable host throws out of construction. Deferred, the
// probe runs inside the spawn cycle: an unreachable host is a `"network"`
// fault that flows through `disconnected → backoff → disconnected → …`,
// retrying indefinitely until it's reachable again (never terminal — see
// the reconnect-terminates note above), instead of crashing the caller.
const session = makeSession({
  connectOnce: sshConnector({
    host,
    resolveDrvPath: () => resolveDrv(host),
    binary: "my-agent",
  }),
});
```

The bash equivalent for shell-only contexts (`just dev` recipes) is `sys=$(ssh "$host" nix-instantiate --eval --expr builtins.currentSystem)` with the surrounding quotes stripped — but the TypeScript consumer should reach for `resolveSystem`. The package still has no opinion on how the `drvBySystem` map gets populated: bake it via `builtins.toJSON` at flake-eval time, load it from a config file, or compute it at runtime — `resolveSystem` works for any of them.

## Status

Pre-1.0; API may shift. Used by [`packages/surface/example/remote-process-monitor/`](../surface/example/remote-process-monitor/) and (planned) `kolu`'s `RemoteTerminalBackend` (R-2 of [juspay/kolu#951](https://github.com/juspay/kolu/issues/951)).
