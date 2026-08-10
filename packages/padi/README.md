# @kolu/padi

The per-host **terminal-workspace daemon** package. One `padi` (படி, the stepped
stand a koḷu is arranged on) owns everything about one host's terminals —
registry, fold, lifecycle, fs/git, bytes, persistence, kaval supervision — and
serves it as **one complete surface**, `padiSurface`.

**The package was born in W1 and became a process at W2.2** (the padi plan of record,
[`docs/atlas/.../padi.mdx`](../../docs/atlas/src/content/atlas/padi.mdx), PR
#1649). Location is structure: daemon code lives here rather than camping in
`packages/server`; W1 moved the domain once, and W2.2 made that package the
durable authority without a second relocation.

## W1 is ONE PR, in three commit stages (C → M → R)

- **W1.C — the contract** (this file's `./surface`). `padiSurface` 1.0: the
  composed `terminals` collection (`authored ⋈ snapshot`, one writer), a
  recency-free `urgency` fold, `activity`, the repo/file `{seq}` pulses, fs/git +
  worktree + byte (`scratch.write` / range-capable `preview.read`) procedures,
  `transcript.exportHtml`, lifecycle + chrome procedures, `session.restore` /
  `import`, the `terminalExit` event, and the `terminalAttach` byte stream —
  **every member annotated with a forwarding policy** (`value` = hold-open vs
  `delta` = fail-through, only `activity`/`terminalAttach`) — plus the frozen
  **control core** (hello · version · drain · clock.now). Nothing served; zero
  runtime change.
- **W1.M — the motion**. The terminal domain relocates OUT of `packages/server`
  INTO this package, verbatim (registry · lifecycle · fold + metadata · endpoint
  bindings · scratch/transcript/worktree · session persistence · MRU trackers).
  This adds a **node-only side** beside `./surface`. Pure relocation — no logic,
  wire, or UX change; git detects the moves as renames.
- **W1.R — the rewiring**. The package serves `padiSurface` COMPLETE, natively
  (`implementSurface` is fail-fast — no member may stub, because every backing
  now lives here), and the client migrates onto it one member per commit, deleting
  the root `terminal.*` namespace as it goes. Sealed by a package-boundary test.

## W2.2 — the binary and its identity (stage 1)

The package graduated to a **process**: `package = process = restart-hash`.

- **The entry.** `./src/bin.ts` (the `padi` executable) → `runPadiDaemon`
  (`./daemonMain`): resolve the state-root → serve `padiSurface` + the frozen
  control core over a unix socket → adopt-or-spawn padi's OWN kaval → reconcile
  the saved session → stay up until drained. The Nix wrapper runs it as
  `node --import <tsx loader> bin.ts` with the joint `PADI_BUILD_ID` staleKey
  (a content hash of padi's daemon source closure, DERIVED from the package.json
  `dependencies` graph in `default.nix` — the edges it rests on are guarded by
  `buildId.closure.test.ts`) and `PADI_COMMIT_HASH` navigable source identity.
  The pair is both-or-neither: both values are non-empty or both variables are
  absent; a half-baked or explicitly empty baked identity crashes at boot.
- **The toolchain it hands its terminals** (kolu-pty's `readAgentToolsBake`).
  Every terminal padi spawns gets kolu's own CLIs (`kaval-tui`, `padi-tui`,
  `kolu`) on `PATH` plus `KOLU_TERMINAL_TOOLS_PATH`, so an agent inside can drive
  its siblings and reach the MCP face. The dirs are a fact padi is **told**
  (`KOLU_AGENT_TOOLS_PATH`, baked by the agent closure's own wrapper on a remote
  host, forwarded by kolu-server locally), never one it derives — deriving from
  `execPath`/`argv` would resolve to the tsx loader or to whatever build happens
  to be installed, reintroducing exactly the daemon/tool skew the staleKey above
  exists to prevent. Unbaked (from-source dev/e2e) → no toolchain, injected
  nothing, stated rather than guessed. The **bake** name (what a wrapper tells a
  daemon) and the **stamp** name (what a daemon tells a terminal) are deliberately
  two variables: nothing writes the bake into a terminal, so a kolu launched
  inside one cannot inherit a foreign build's tools.
- **Identity IS the state-root** (`./stateRoot`). Binding requires an explicit
  root (`--state-root` or `KOLU_PADI_STATE_DIR`) — there is no silent default
  (#1334). Production nix wrappers supply `$HOME/.local/state/padi` (not
  `$XDG_STATE_HOME`); dev/test pass a private dir. That folder holds padi's
  `session` / `activityFeed` / `lastPairedDaemon` in its OWN `Conf` (`./stateStore`,
  a twin of kolu-server's — `preferences` stays kolu-server's), snapshotted into a
  rotated `backups/` ring at every open and daily (#1658, `kolu-shared`'s
  `stateBackup`; browsed/restored via the `backups.list` / `backups.restore`
  surface members, 5.2). The socket + gate
  live in the **boot-wiped runtime dir** keyed by a **digest** of the state-root
  (`$XDG_RUNTIME_DIR/padi-<digest>/`, `kaval-<digest>/`), so a stale gate can never
  outlive a reboot and two padis at distinct state-roots never touch each other's
  kaval (the #1313 property). A `state-root` manifest maps the digest back, so a
  flag-less `kaval-tui` keeps labelling what it discovers. The state-root is also
  padi's **anchor** (#2010): delete it — `git worktree remove` on a dev
  workspace — and the daemon reaps itself (the spine's `anchor-gone` self-exit,
  kaval alike via its manifest) instead of leaking forever, and the kolu-server
  binder treats the gone root as terminal rather than respawning into it.
- **The frozen control core** (`@kolu/surface-daemon`'s identity/drain fragment,
  extended by `./surface`'s padi-only version + clock members) — hello · version
  · drain · clock.now — is served BESIDE
  `padiSurface` (sibling key `control`), so a binder reaches it even when
  `padiSurface` is version-skewed. It never versions.

The **stage-1 acceptance gate** is `./dial.test.ts`: a real spawned padi at a
private state-root, dialed over its socket, handshakes the control core and
round-trips a terminal through its own kaval — and two padis at distinct
state-roots stay isolated. *(kolu-server binds this process in stage 2 — the
cutover.)*

Padi also reads its kaval's build identity through that same frozen control
fragment, before touching the versioned pty-host surface. A surviving kaval
from before the fragment has a served socket but no identity route: padi treats
that structured route absence as an older build and reports the existing
update nudge. Only an honest missing listener becomes a null probe; other probe
failures stay loud.

A survivor from before the **Effect-4 protocol epoch** can't be asked anything at
all — version negotiation lives inside the protocol that was replaced, so the
peer either speaks first in a framing nothing here can decode or waits forever
for a hello nobody sends any more. The supervisor names that third fact
(`unspeakable-protocol`) at the transport instead of guessing a version, and acts
on it only after corroborating that it owns the gate at this rendezvous and has
verified the pid the gate names. The dispositions differ by daemon: a pre-epoch
**kaval** is recycled (it cannot drain), a pre-epoch **padi** is **taken over** —
stopped by signal, the in-process shutdown a drain verb would have asked for, and
replaced by a daemon of this epoch that seeds from the same state-root on disk. A
socket squatter that is not provably ours still takes the untouched
foreign/probe-failed path, so nothing here puts a signal near a process padi
hasn't proven is its own.

## W3.1 — the remote binding: padiSurface over ssh

kolu-server can bind a padi **one ssh hop away** — the whole canvas becomes a
remote host — reusing the local arm's seam, not a parallel one:

- **`padi --stdio`** (`./stdioBridge`) — the durable-daemon FRONT. It resolves
  padi's digest-keyed socket exactly as `runPadiDaemon` does, then relays this
  process's stdio onto it via the shared `frontDaemonOverStdio` primitive
  (adopt-or-spawn; the spawn re-execs `padi` minus `--stdio`, so the daemon that
  comes up runs `runPadiDaemon` and owns its kaval). The twin of
  `kaval/src/stdioBridge.ts`: `ssh <host> padi --stdio` fronts the durable padi, so
  its kaval + PTYs outlive the ssh link (detach → reattach). `./dial.test.ts` gains
  a stdio-front block proving the control-core handshake + terminal round-trip over
  the byte relay, minus ssh.
- **The binding** (`packages/server/src/padi/remotePadiBinding.ts`). The knob
  **`KOLU_PADI_HOST=<ssh host>`** — OFF by default, no UI (the picker is W3.2) —
  branches kolu-server onto a Surface Remote `makeSession` +
  `sshConnector({ binary: "padi", extraArgs: ["--stdio"] })` composition (the
  exact stack `kaval-tui --host` rides). It re-runs `@kolu/padi/dial`'s
  control-core `hello` + skew refusal over the ssh-bridged link, scopes to
  `.surface.padi`, and re-serves through the SAME `RemoteMirrorSession` seam the
  local `PadiBindingSession` plugs into. Unset → today's local binding,
  byte-identical.
- **One drv provisions both daemons.** kolu-server's Nix wrapper bakes the
  exact source flake as **`SURFACE_AGENT_FLAKE_REF`**. On the first remote dial,
  `@kolu/surface-remote` probes the host's Nix system and evaluates only that
  source's matching padi `.drv`. Because padi's wrapper bakes `KOLU_KAVAL_BIN`
  (kaval rides INSIDE padi's closure), provisioning that ONE drv ships both —
  `provisionAgent` evaluates, transfers, realises, and roots it through Nix, and
  `ssh <host> padi --stdio` runs it. A deploy of the home-manager module carries
  and GC-roots that closure in the generation itself
  (**`services.kolu.agentPackages`**, required with no default — the set is read
  from `nix/agent-packages.json`, never hand-listed), so the first remote dial
  ships bytes it already holds rather than consulting a binary cache or compiling
  a daemon over ssh. A host that already has the output short-circuits to a warm
  GC-root refresh.
- **Convergence needs nothing new.** adopt-or-spawn + re-adopt fall out of the
  reconnecting Surface Remote session + `frontDaemonOverStdio` (kill the remote
  padi → the reconnect respawns it; restart kolu-server → it re-adopts the
  still-running daemon, PTYs intact). The remote **nix-built padi wrapper**
  supplies `KOLU_PADI_STATE_DIR` on the host (no silent code default — #1334);
  the binder passes nothing unless it isolates via
  `KOLU_REMOTE_PADI_STATE_DIR` / `--state-root`. A fresh host's legacy import
  correctly no-ops.
- **The ssh-user 0700 caveat.** The remote padi runs AS THE SSH USER, and (like
  kaval) serves its socket in a `0700` owner-only runtime dir — so the SSH identity
  **is** the daemon owner. Two ssh users get two isolated padis by construction; a
  user who cannot reach the owner's `0700` dir cannot reach the daemon. Enforced on
  the remote (padi/kaval refuse a non-private dir), not from the binder. Pick your
  ssh user deliberately — it decides who owns the host's terminals.

## Logs — debugging a detached daemon (P0)

A padi (and its kaval) is a **detached daemon**: it outlives the parent that spawned it —
an ssh `--stdio` front that closed, or a kolu-server that exited. Historically its whole
log stream went to `/dev/null` (`stdio: "ignore"`), so a live production freeze was
undiagnosable from the logs the code correctly writes. Now **every** daemon spawn path
(the remote detached front, the local kolu-server→padi spawn, the padi→kaval spawn) ends
with the daemon logging to a **deterministic file under its own identity**, in two layers:

| file | what | bound |
| --- | --- | --- |
| `<state-root>/padi.log.N` | padi's **pino** stream (the primary structured log — the WAL-watcher lines, domain events) via `pino-roll`; the daemon logs it **AND** stderr together (a multistream), so a foreground dev run stays visible and journald / a crash file still work. `pino-roll` appends a generation index, so the live file is `padi.log.1` (then `.2`, `.3`) | size-capped: **10 MB × 3** kept generations |
| `<state-root>/padi.stderr.log` | padi's **raw stderr** crash-catcher — what pino can't see: native errors, an uncaught-exception / unhandled-rejection stack. Wired **only when the spawn is DETACHING** (nobody holds the child's stderr); an attached/systemd spawn keeps its stderr in journald instead | **truncate-on-boot**: each boot rotates the previous to `.stderr.log.old` (one generation) |
| `<kaval digest home>/kaval.log` | kaval has no pino — its stderr (the surface-daemon `stderrLogger`) **is** its log | truncate-on-boot (`.log.old`) |

`<state-root>` is padi's persistent state root (`$KOLU_PADI_STATE_DIR` or
`--state-root` — required; the nix wrappers supply `~/.local/state/padi` for
production); the kaval home is its digest-keyed runtime dir (beside its socket).
**No env knob** — the two modes are structural: the **daemon entrypoint** (`runPadiDaemon`,
which every spawn path runs) unconditionally logs to the multistream (and crashes loudly if
the state root is unwritable), while the `--stdio` front, kolu-server's transitive import of
padi domain modules, and any test that doesn't boot the daemon never run it and keep stdout.
To debug a remote box: `ssh <host> tail -f ~/.local/state/padi/padi.log.*` (the pino-roll
generations) or `ssh <host> cat ~/.local/state/padi/padi.stderr.log` for a detached crash.

## The export map

- **`@kolu/padi/surface`** — BROWSER-SAFE. The current `padiSurface` Effect
  Schema contract, the per-member **forwarding-policy** annotations (`value` =
  hold-open vs `delta` = fail-through), and the padi control types (version ·
  drain · clock.now). Its read-only `processMemory` cell carries padi and kaval RSS as
  the honest `ok | absent | error` three-way: one osfacts snapshot samples the
  endpoint-owned process target and rejects a result from a superseded kaval
  generation. The browser-safe entry imports no `node:` runtime.

- **Node-only entries** — the daemon main, dial/binding, state-root, endpoint,
  log, transcript, and upload modules compose and serve that contract. Padi is
  the native authority; kolu-server binds or mirrors it rather than supplying a
  backing shim.

- **`@kolu/padi/render`** and **`@kolu/padi/read`** — the CLI faces' shared
  view + data layers. `render` is pure formatting (the roster table's
  `ID · STATE · REPO·BRANCH · PR · AGENT · FOREGROUND` columns, the PR/checks
  and agent-status folds, plus `shortId` and `resolveTerminalId` — the
  id-prefix resolution every `<id>` argument accepts, which is a pure fold over
  an id list and so belongs on this side of the line) with no I/O; `read` is
  the one-shot reads off the `terminals` collection — `readTerminalKeys` (the
  live id list `resolveTerminalId` folds) and `settledSnapshot` — as Effects,
  so a Ctrl+C tears their subscriptions down.
  Both **graduated out of `padi-tui`** when `kolu`'s terminal verbs became
  their second consumer, the same move and the same reason as the LIVE side
  (`watchTerminals`/`awaitAgentState`) graduating into the `dial` entry when
  kolu's MCP face became *its* verbatim second consumer: one padi-shaped
  vocabulary with two faces reading it, not two copies held in lockstep by
  JSDoc cross-reference. They stay here rather than in `@kolu/surface` because
  they speak **padi's** records — the generic wait scaffold went the other way.
  All of it lives under `src/cliClient/` — `render.ts`, `read.ts`, and the
  `watch.ts` wait kit the `dial` entry re-exports — the same
  one-cluster-one-directory shape as `terminalEndpoint/` and
  `terminalWorkspace/`. The pure `terminalVocab.ts` they all fold over sits one
  level UP, at the package root: the SERVER speaks it too (supervision-edge
  delivery narrows a supervisor with `activeAgent` before writing into its
  mailbox), and a daemon module reaching into a `cliClient/` directory would
  point the arrow backwards. The **subpaths above are unchanged**: the directory
  is padi's internal layout, not its public one.

## The attention flow — the supervision edge IS the subscription

padi already computed WHO needs attention: the `urgency` cell's `awaitingIds` (an
agent blocked on a person) and `finishedIds` (a turn that ended *and* whose output
then went quiet — the [effective-finish](../../docs/atlas/src/content/atlas/effective-finish.mdx)
conjunction, which is what keeps a background sub-agent's churn from reading as
"done"). What `src/attention/` adds is the derivative: the cell is a LEVEL, and a
notification needs an EDGE.

That edge is shared, not re-derived — `@kolu/terminal-vocab/attentionTransitions`
is the same decision kolu's browser fires its sound and OS popup on, so a person
at the canvas and a supervising agent in a PTY are told about the same events by
one definition. It fans out to two sinks:

- **The supervision edge.** A terminal records who spawned it (`parentId`), and
  kaval serializes input into a terminal — a single-writer mailbox. So a worker
  going blocked delivers into its supervisor's mailbox *by construction*: nothing
  arms this, because dispatching the worker already did. The recurring failure it
  ends is a worker's ask waiting to be **discovered** rather than **delivered** —
  every fix that adds a *listener* leaves "dispatch a worker without arming its
  notification" spellable, and a coordinator that forgets once drops a report on
  the floor. **Only agent terminals are written to**; a person's shell is never
  typed into (they have the canvas, the Dock and the OS notification instead).
  One fold's edges arrive as one **frame**, so a supervisor is woken *once* per
  frame however many of its lanes moved — a kaval recycle that retires twenty
  workers is one fact, not twenty submits into one mailbox.

- **Standing subscriptions** (`watch.open` / `drain` / `close` + the `watchPulse`
  doorbell), for a supervisor that has no terminal for the edge to reach — an
  MCP-only agent. Events buffer in padi, which outlives both a `kolu mcp` process
  and kaval, so the gap between two drains is not a hole, and a subscription is
  keyed by a caller-chosen NAME so those restarts reattach rather than start
  empty. (padi's OWN restart clears them — they are process memory. A drain
  against a name it no longer holds raises the declared `WatchSubscriptionNotFound`
  rather than answering an empty batch, because "not subscribed" and "nothing
  happened" are the two states a supervisor must never confuse — and `close`
  raises the same error rather than answering `false`, for the same reason.) A
  drain is **acknowledged** (send its `ackAfter` back as the next `after`), not
  destructive, so a reply lost in flight costs a repeat rather than a report;
  overflow is *reported* (a `dropped` count), never silently truncated — and a
  drop that lands *after* a reported batch is not covered by that batch's
  acknowledgement, so it rides the next report rather than being erased.

A terminal LEAVING is an event too (`kind: "gone"`), for the same reason: a
supervisor waiting on a worker that no longer exists must be told, not left
waiting.

**The one honest limit of the edge**: delivery is a PUSH into a live mailbox, so
a supervisor that is *dormant* (slept or parked — its PTY released) is not told,
and is not told on wake either. The fact survives — it is in the `urgency` cell
and in every standing subscription that matched — but that particular edge does
not, and padi logs a **warning** rather than skipping quietly, because a silently
undeliverable supervision edge is the same shape of silence this whole flow
exists to remove. Retention across a wake would need a delivery contract with
answers this module does not have (how long to hold, what flushes it, what if the
supervisor never wakes); the standing subscriptions are the durable half today. A kaval recycle retires every active terminal id, so this is the signal
that a lane's id is stale rather than merely quiet.

## What padi knows nothing about

Location is structure, so the boundary is defined as much by what padi refuses to
reach for as by what it owns:

- **`packages/server`.** padi NEVER imports kolu-server — the dependency arrow
  points strictly OUT. The few facts the server knows about itself are INJECTED at
  boot (`setKoluServerProcessId` · `setSpawnServerVersion`), never imported, so no
  edge ever points back in.
- **The app logger.** padi has its OWN identity-free pino logger (`./log.ts`): it
  mirrors kolu-server's level/format but does not import the server's
  `hostname.ts` identity base, so the arrow is `@kolu/padi → pino`, never back into
  `packages/server`.
- **The conf store.** Preferences — plus the still-`koluSurface`-hosted `session`
  / MRU / `terminalList` primitives — stay kolu-server's single source of truth
  until W2.2 gives padi its own state-root. padi reads/writes `session` only
  THROUGH the framework-owned surface cell (backed by `confStore(store,
  "session")`), never the raw conf store, so it carries no dependency on the
  server's `state.ts`.

## Status

- **W1.C / W1.M / W1.R — shipped:** the contract, terminal-domain move, native
  serving, and client migration sealed the package boundary.
- **W2.2 — shipped:** the package became the durable process —
  `package = process = staleKey` — and owns its kaval.
- **W3.1 — shipped:** local and remote binders consume the same complete surface;
  the PWA, kolu-server, kolu CLI/MCP, and padi-tui are live consumers.
- **Current contract:** the version is `PADI_SURFACE_VERSION` in `src/surface.ts`
  (whose comment carries the per-bump history); exact member/policy coverage and
  version pins live in `src/surface.test.ts`. Deliberately not restated here — a
  hardcoded number drifted twice before it was noticed.
