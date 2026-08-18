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
  inside one cannot inherit a foreign build's tools. Because the bake is frozen
  at daemon spawn while padi outlives kolu upgrades — and the tools bundle is
  invisible to the `PADI_BUILD_ID` derivation above — padi **records** its bake
  at boot (`agent-tools-bake`, beside the `state-root` manifest) and every
  same-machine supervisor (kolu-server's binder, the `padi --stdio` front)
  drains a resident whose record names a different toolchain than its own
  build's, so a kolu-CLI-only upgrade still reaches new terminals
  (`./src/agentToolsBake.ts`, juspay/kolu#2146).
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
  flag-less `kaval-tui` keeps labelling what it discovers — and so a flag-less
  client can pick the **primary** padi out of several live ones: the one whose
  manifest names the state root the client's own environment resolves to
  (`$KOLU_PADI_STATE_DIR`, else the production formula). Extras are keyed to
  explicit roots, so that is a read-back of recorded identity, not a guess
  between equals (`primaryPadiAmong`, #2154). The state-root is also
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

- **The `dial` entry's wait kit** — `awaitTerminalCondition` is the ONE
  block-on-a-terminal-condition engine every face rides. It takes the condition
  as data (`idle` · `match` · `agent`) plus two orthogonal modifiers: a
  `settledMs` **conjunct** (met only once output has also been quiet that long,
  with a condition that stops holding re-entering the wait) and a `captureScreen`
  **stamp** (the met carries the terminal's rendered screen, read while the
  wait's own subscriptions are live and discarded-and-retaken if the met
  CANDIDATE moved under the read — narrower than "a byte arrived", which has no
  fixed point). They live here rather than in a driving
  loop because the races they close are between a caller's separate
  *invocations* — `kolu wait --settled/--snapshot` and `kolu debrief` are that
  engine's argv face
  ([kolu#2139](https://github.com/juspay/kolu/issues/2139)). Two named waits
  remain — `awaitAgentState` (padi-tui's `cmdWait`, the MCP face's
  `wait_agentState`) and `awaitOutputSettled` (`wait_outputSettled`) — because
  their met payloads ARE those tools' wire frames; they are spellings of the
  engine, each carrying its own `closed` retry advice. The MCP face's
  `settledMs`/`screenTail` options are forwarded *through* those two rather than
  around them, so each wire frame keeps exactly one owner
  ([kolu#2152](https://github.com/juspay/kolu/issues/2152)) —
  `awaitOutputSettled` deliberately takes only the capture, since a second
  quiescence window over an `idle` condition just means quiet-for-max. The
  `match:` form has no wrapper: `kolu wait` is its only consumer and calls the
  engine directly.

  The three condition FORMS are not braided through the engine body: each has
  its own runner (`conditionForm`), so the branch on which form this is happens
  once and the shared spine — the attach feed, the conjunct's window, the
  met-candidate cell — is lent to it rather than re-decided per wiring point.

- **`@kolu/padi/render`** and **`@kolu/padi/read`** — the CLI faces' shared
  view + data layers. `render` is pure formatting (the roster table's
  `ID · STATE · REPO·BRANCH · PR · AGENT · FOREGROUND` columns, the PR/checks
  and agent-status folds, plus `shortId` and `resolveTerminalId` — the
  id-prefix resolution every `<id>` argument accepts, which is a pure fold over
  an id list and so belongs on this side of the line) with no I/O. It also owns
  `parsePlacementFlags`, the `--toplevel` / `--parent` decision BOTH CLI faces
  run: same reason as the roster table, one rule up from formatting — two faces
  that must answer a create identically may not each hand-roll the answer. `read`
  is
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
  All of it lives under `src/cliClient/` — `render.ts`, `read.ts`, `tail.ts`
  (the tail-mode screen slice, a zero-import leaf `render.ts` re-exports so the
  wait kit can reuse it without dragging `columnify` into every dial consumer),
  and the `watch.ts` wait kit the `dial` entry re-exports — the same
  one-cluster-one-directory shape as `terminalEndpoint/` and
  `terminalWorkspace/`. The pure `terminalVocab.ts` they all fold over sits one
  level UP, at the package root: the SERVER speaks it too (supervision-edge
  delivery narrows a supervisor with `activeAgent` before writing into its
  mailbox), and a daemon module reaching into a `cliClient/` directory would
  point the arrow backwards. The **subpaths above are unchanged**: the directory
  is padi's internal layout, not its public one.

## Settle events — the standing subscriptions

padi already computed WHO needs attention: the `urgency` cell's `awaitingIds` (an
agent blocked on a person) and `finishedIds` (a turn that ended *and* whose output
then went quiet — the [effective-finish](../../docs/atlas/src/content/atlas/effective-finish.mdx)
conjunction, which is what keeps a background sub-agent's churn from reading as
"done"). What `src/attention/` adds is the derivative: the cell is a LEVEL, and a
subscriber needs an EDGE.

That edge is shared, not re-derived — `@kolu/terminal-vocab/attentionTransitions`
is the same decision kolu's browser fires its sound and OS popup on, so a person
at the canvas and a subscribing agent are told about the same events by one
definition.

It feeds **standing subscriptions** (`watch.open` / `drain` / `close` + the
`watchPulse` doorbell). The `wait_*` tools are edge-triggered on a live call, so
anything between two waits is unobservable — which is how a worker's report
reached nobody when its watcher had returned and had not been re-armed. These are
level-triggered with memory: events accumulate whether or not anyone is asking, so
the gap between drains is not a hole.

Events buffer in padi, which outlives both a `kolu mcp` process and kaval, and a
subscription is keyed by a caller-chosen NAME so those restarts reattach rather
than start empty. (padi's OWN restart clears them — they are process memory. A
drain against a name it no longer holds raises the declared
`WatchSubscriptionNotFound` rather than answering an empty batch, because "not
subscribed" and "nothing happened" are the two states a supervisor must never
confuse — and `close` raises the same error rather than answering `false`, for the
same reason.) A drain is **acknowledged** (send its `ackAfter` back as the next
`after`), not destructive, so a reply lost in flight costs a repeat rather than a
report; overflow is *reported* (a `dropped` count), never silently truncated — and
a drop that lands *after* a reported batch is not covered by that batch's
acknowledgement, so it rides the next report rather than being erased.

A terminal LEAVING is an event too (`kind: "gone"`): a supervisor waiting on a
worker that no longer exists must be told, not left waiting. A kaval recycle
retires every active terminal id, so this is the signal that a lane's id is stale
rather than merely quiet.

## The agent-state watch — the other source

`src/attention/` holds **two** event sources, and a subscriber picks one. The
settle detector above answers a question padi decides for you: *who just started
needing someone*, with the effective-finish quiet conjunct baked in. The agent-
state watch (`stateWatch.ts`) answers the question the SUBSCRIBER asks: *which
agent buckets do I care about* (`states`), *how long must one hold before I hear
about it* (`heldForMs`), and *how often should I be told again while it keeps
holding* (`nagMs`). Those three knobs are the whole of `kolu watch --states /
--held-for / --nag` and of the same-named `watch.open` params — one engine, two
faces, no client-side filtering anywhere.

It reads the ADAPTER, never the bytes: the level is `agentBucket(agent.state)`,
what the agent's own adapter published, so a quiet screen is not taken for an
idle agent (an idle grok repaints about once a second, which starved a byte-quiet
gate forever). `heldForMs` debounces the STATE.

Its events are `snapshot` (already matching when you subscribed — the standing
set, handed over before anything that changed since), `transition` (entered a
state and held it), and `nag` (still holding, one interval later). The nag is the
level trigger, and the difference between a doorbell you can miss and one that
keeps ringing.

**A subscription is fed by exactly one source**, chosen by whether it named any
of the three knobs — never merged, because the two answer different questions in
different vocabularies. It follows that the state feed carries no `gone`: a
level-triggered subscriber is not blocked on anything, so a terminal that leaves
simply stops being reported. It follows too that re-opening a name with a
DIFFERENT filter empties its queue — those buffered answers belong to a question
the caller has stopped asking, and the new attachment's snapshot is the standing
truth that replaces them.

Both sources stamp from ONE daemon sequence (`eventSeq.ts`), because a
subscription's acknowledgement watermark is a single number and has to mean the
same thing whichever source filled its buffer.

The live face is the `watchStates` stream member — the same engine with no queue
in front of it, for a consumer (`kolu watch`) that holds a socket rather than
coming back for a drain. Its first frame is the snapshot, which is what makes the
framework's transparent re-subscribe re-lead with fresh truth.

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
