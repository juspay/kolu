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

- **W1.C — the contract** (then `./surface` here; the spec lives in
  [`@kolu/padi-client`](../padi-client) now). `padiSurface` 1.0: the
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
  This adds a **node-only side** beside the contract. Pure relocation — no logic,
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
  (`./src/agentToolsBake.ts`, juspay/kolu#2146). The toolchain path
  starts with the wrapper that also bakes agent-distro, so on the machine
  running kolu (the floor rides that wrapper) an upgrade that moves only the
  agent-distro pin moves the record too and restarts padi, whose rebind makes
  kolu-server deliver the newer agents (below); a remote host's `padi-agent` carries no pin, so a pin-only bump
  leaves it untouched — a coupling `default.nix`'s wrapper proofs assert.
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
  extended by `@kolu/padi-client/surface`'s padi-only version + clock members) — hello · version
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
  exact stack `kaval-tui --host` rides). It re-runs `@kolu/padi/remote-dial`'s
  control-core `hello` + skew refusal over the ssh-bridged link, scopes to
  `.surface.padi`, and re-serves through the SAME `RemoteMirrorSession` seam the
  local `PadiBindingSession` plugs into. Unset → today's local binding,
  byte-identical.
- **One drv provisions both daemons.** kolu-server's Nix wrapper bakes the
  exact source flake as **`SURFACE_AGENT_FLAKE_REF`**. On the first remote dial,
  `@kolu/surface-remote` probes the host's Nix system and evaluates only that
  source's matching padi `.drv`. Because padi's wrapper bakes `KOLU_KAVAL_BIN`
  (kaval rides INSIDE padi's closure), provisioning that ONE drv ships both —
  `provisionAgent` lands and roots it through Nix, and `ssh <host> padi --stdio`
  runs it. A kolu built from a published master revision is found in kolu's
  **closure index** (`ca-index` branch, written by `nix-cache.yml`'s
  `publish-closures` job): the host pulls the content-addressed padi from the
  cache itself, so a Linux host on Nix 2.17–2.34 needs no `trusted-users` and no
  cache key. Any other build (a dev checkout, an unpublished rev) takes the
  sender's own route: rewrite, ship, or build on the host. A deploy of the home-manager module carries
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

## Idle cost — what padi stopped doing while you work

padi is a daemon on a machine somebody else is using, so the standing cost of a
workspace nobody is touching is a product property. A 90 s CPU profile of a live
16-terminal padi ([#2286](https://github.com/juspay/kolu/issues/2286)) found a
handful of habits that paid for nothing; each is now a rule rather than a tuning:

- **Discovery scans the runtime regime IN FORCE, never both.** `discoverPadiDaemons`
  (and kaval's own) used to union the env-derived drawer with the forced `/tmp`
  fallback on every pass — a `readdirSync("/tmp")` (209 K entries on the reporting
  host) twice per 10 s `hostInventory` tick, for a drawer this host's padis never
  bind in. `runtimeRegimeInForce()` (`@kolu/surface-daemon`) is the one answer, and
  the poll reads only that drawer. The **dial** paths are the deliberate exception —
  `residentPadiSocket` (the binder's adopt read-back) and `resolveRunningPadiSocket`
  (the flag-less CLI/MCP resolution) both pass `DIAL_REGIMES` and still probe every
  drawer, because each runs once per binding or per command and what that buys is
  #1713's 30 s hang, and a `kolu` that can find the padi it wants.
- **Boot sweeps the corpses.** Nothing wipes `/tmp`, so every padi or kaval that
  ever crashed left its runtime home there forever (5.4 K of them on that host).
  `reapStaleDaemonHomes` runs once in `padiDaemonProgram`, after this padi has
  claimed its own gate, and removes only a home whose own gate file proves its
  owner is gone — a live holder, a gateless home (a daemon mid-boot looks
  identical), a home that is not owner-only and an unreadable gate all survive.
- **The port sampler has ONE cadence.** `ports/sampler.ts` ticks at
  `PORT_SCAN_INTERVAL_MS` (5 s). It used to also fire on terminal output behind a
  1 s floor, which forked an `osfacts` child per second for as long as any TUI was
  live — the single largest JS frame in the daemon (19.9% of busy time under load,
  30.7% under light). The floor bounded the cost of a PASS and said nothing about
  the fork before it.
- **One `/proc` read per foreground sample, and no re-parse of an unmoved file.**
  `AgentTerminalState.readProcessSnapshot()` is the host's single read, memoised
  against the sample's identity in `AgentEngineState` and shared by all seven
  adapters; claude-code's session file and omp's breadcrumb ride `kolu-io`'s
  `stampedCache`, keyed on `(mtimeMs, size)`.
- **Focus is not a dirty source.** `setActiveTerminalId` pulses no
  `terminals:dirty`; the marker rides the autosave gate's own 5 s trailing debounce
  onto `saveActiveTerminalId`, which patches one field of the blob already on disk.
  Clicking between tiles used to rewrite every terminal's record — 253 KB/s of disk
  on a 16-terminal workspace. Shutdown still reads the LIVE marker, so nothing is
  lost at the edge that matters.
- **Nothing dials odu while nobody is looking.** The odu sibling's re-serve pins
  its session on the FIRST subscriber and lets the link go 30 s after the last one
  leaves, so a machine that has never run odu pays one failed `connect` a minute
  at most — a syscall, never a process, re-probed at the reconnect ladder's
  ceiling because nobody's daemon gets started by polling for it — and an
  Inspector nobody is looking at pays nothing at all. It holds END TO END because
  nothing re-serves the sibling a second time: kolu-server forwards odu's tags
  straight down the padi link it already holds, so a browser's demand IS padi's.
  What that costs is stated rather than hidden: a forward has nothing to hold a
  subscription open WITH, so a padi link death ENDS a sibling subscription where
  a mirror would have ridden it out — as the one retryable end, so the browser
  re-asks and the next frame it paints is a fresh reading rather than a replay.
- **A repo's change watcher outlives a browser's focus switch.** kolu-git retires
  a repo-change entry 30 s after its last subscriber leaves rather than on the
  drop, and a subscription taken inside that window reuses the live upstreams —
  so the Code tab's focus-driven re-key is an attach where it used to tear down
  and rebuild four inotify watchers, 120 of each per 5 minutes.

## The export map

- **The CONTRACT is [`@kolu/padi-client`](../padi-client)** — `padiSurface`
  itself, the vocabulary it speaks, the local `connectPadi` dial, the rendezvous
  path algebra, and the terminal watch kit all live in a sibling package now, so
  a consumer can hydrate the contract WITHOUT the daemon: hydration is
  per-package, and this manifest names kaval, which names `node-pty`. padi
  depends on it and serves it; the arrow never points back, and there is exactly
  one spec. What a client reaches for is documented there — this file is the
  daemon.

- **Node-only entries** — the daemon main, binding, state-root discovery,
  endpoint, log and transcript modules compose and serve that contract.
  Padi is the native authority; kolu-server binds or mirrors it rather than
  supplying a backing shim.

- **The `@kolu/padi-client/watch` wait kit** — `awaitTerminalCondition` is the ONE
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
  and agent-status folds, plus `shortId`, the short form the roster prints) with
  no I/O. The id-prefix RESOLUTION every `<id>` argument accepts is no longer
  here: it is `@kolu/padi-client/terminalId`, a zero-import leaf, because the
  rule is a property of padi's addressing rather than of any face that renders
  it — and a client that only wants to turn a user's `7f3e` into an id should
  not install a PTY host to do it. `render` does NOT re-export it: every face
  imports it from where it lives, so this module is the door for exactly what it
  still holds. It also owns
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
  Both live under `src/cliClient/` — `render.ts` and `read.ts`, and nothing
  else: the wait kit a reader of this paragraph used to be sent here for is
  `@kolu/padi-client/watch`, one package down, and this package has no `./dial`
  entry to re-export it through (the dial is `@kolu/padi-client/dial`). The
  tail-mode screen slice
  went the whole way it was always headed and is now
  `@kolu/padi-client/screenTail`, a genuinely zero-import leaf: it folds padi's
  `screen.text` REPLY, so it belongs beside that reply's schema and not behind a
  manifest naming `columnify` — the same
  one-cluster-one-directory shape as `terminalEndpoint/` and
  `terminalWorkspace/`. The pure `terminalVocab.ts` they all fold over sits one
  level UP, at the package root: the SERVER speaks it too (supervision-edge
  delivery narrows a supervisor with `activeAgent` before writing into its
  mailbox), and a daemon module reaching into a `cliClient/` directory would
  point the arrow backwards. The **subpaths above are unchanged**: the directory
  is padi's internal layout, not its public one.
- **`@kolu/padi/containingTerminal`** and
  **`@kolu/padi-client/watchScope`** — the two PURE concept modules a static
  consumer imports when the dial entry is too heavy: the self-stamp sum
  (`containingTerminalId` + `confirmInFleet` + `CONTAINING_TERMINAL_ENV`) and
  the watch-scope constructor (`watchScopeOf` + `scopeAdmits` + the never-match
  refusal types). Both import nothing beyond `kolu-pty`'s env-name constant and
  `@kolu/terminal-vocab` schemas, so a command tree can hold a face's verb table
  statically without a socket ever reaching its parse path — `kolu-mcp`'s tool
  modules are the first-party consumer. They are two packages because the scope
  vocabulary is CONTRACT (a client states a scope; the daemon's registry reads
  it) while "am I inside a kolu terminal" is a question only something inside one
  asks.

## `screen.image` — padi is where the picture gets made

Beside `screen.text` (characters) padi serves `screen.image`: the terminal
rendered to a themed PNG, the read a face that can SHOW an image makes — the
`screen_image` MCP tool and `kolu screenshot`. `lines` bounds it to the last N
rendered rows, capped at `SCREEN_IMAGE_MAX_ROWS` (200) and **refused** above
that rather than clamped; omitted, it is the viewport, which only the daemon
can resolve because only the daemon knows how tall the PTY currently is.

The rendering lives on THIS side of the wire on purpose. kaval hands over
attributed CELLS (`terminal.getScreenCells`, contract 7.1) — characters plus
"palette 4", "rgb 0x78c8ff", "default" — and stops there, because turning
`palette 4` into a colour needs a theme, and the theme is a **per-terminal user
choice padi holds**. So padi is the only process that can answer, and the PTY
host stays free of a wasm rasteriser and several megabytes of font
(`./src/screenImage.ts`).

Layout is not decided here either: `terminal-snapshot` turns grid + theme into
flat drawing instructions, and padi merely rasterises them
(`terminal-snapshot/png`). The browser's copy-screenshot-to-clipboard paints
the same instructions onto a canvas — so the agent's PNG and the user's PNG are
the same picture by construction. The fonts come from the Nix closure
(`KOLU_SNAPSHOT_FONTS_DIR`) and are **required**: a missing font dir fails the
call, because a screenshot in a substitute font would look plausible and be
wrong. CJK and emoji are outside that font set and render as tofu.

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
faces — and the CAP rides inside the interval, never as a fourth knob:
`--nag 30m/3` (or `nagMs: "60000/3"`) is three reminders past the first report,
then quiet about that terminal until the state changes. (The wire carries the
pair as `nagMs` + `nagCount`, and padi's decode refuses the count without the
interval — the pairing is unspellable at the faces, refused at the one
entrance that could still spell it.) `--ignore` / `ignoreIds` (and
`--ignore-self` / `ignoreSelf`, resolved at the face from `$KAVAL_TERMINAL_ID`)
mute known terminals fail-open: a stale id
costs nothing, and a new terminal is always watched. Contrast `ids`, which fails
closed.

It reads the ADAPTER, never the bytes: the level is `agentBucket(agent.state)`,
what the agent's own adapter published, so a quiet screen is not taken for an
idle agent (an idle grok repaints about once a second, which starved a byte-quiet
gate forever). `heldForMs` debounces the STATE.

Its events are `snapshot` (already matching when you subscribed — the standing
set, handed over before anything that changed since), `transition` (entered a
state and held it), and `nag` (still holding, one interval later, and capped
when the interval carried a count — each stamped `nag.index` and `nag.left`,
so a script can tell the last one). The nag is the
level trigger, and the difference between a doorbell you can miss and one that
keeps ringing.

**A subscription is fed by exactly one source**, chosen by whether it named any
of the knobs — never merged, because the two answer different questions in
different vocabularies. It follows that the state feed carries no `gone`: a
level-triggered subscriber is not blocked on anything, so a terminal that leaves
simply stops being reported. It follows too that re-opening a name with a
DIFFERENT filter empties its queue — those buffered answers belong to a question
the caller has stopped asking, and the new attachment's snapshot is the standing
truth that replaces them. The question's CAP survives either kind of re-open:
the attachment hands its per-episode nag counts to its successor, because the
budget is the episode's — only a state change re-arms it.

Both sources stamp from ONE daemon sequence (`eventSeq.ts`), because a
subscription's acknowledgement watermark is a single number and has to mean the
same thing whichever source filled its buffer.

The live face is the `watchStates` stream member — the same engine with no queue
in front of it, for a consumer (`kolu watch`) that holds a socket rather than
coming back for a drain. Its first frame is the snapshot, which is what makes the
framework's transparent re-subscribe re-lead with fresh truth.

## agent-distro — the agents a new terminal gets

padi puts [agent-distro](https://github.com/juspay/agent-distro)'s coding
agents — its one package — on the PATH of every NEW terminal it spawns, and the
Agents setting's profiles, built, in its `AI_PROFILE`
([Agents](https://kolu.dev/agents)). It never DECIDES or fetches anything: the
binding kolu-server reads the host's build of the package off agent-distro's
published index (content-addressed for Linux, signed for a Mac) and has this
host pull it from agent-distro's cache over ssh (`@kolu/surface-remote`'s
`pullClosure`), locks and BUILDS each profile itself (agent-distro's
`lib.mkProfile`, at the package's revision, for this host's system) and ships it
here (`deliverClosure`), rooted — `packages/server/src/agentDelivery/` — and
tells padi each step; padi records the set that landed. For its agents a host
needs only the ssh login, `nix` on that login's PATH and outbound HTTPS to the
cache — no flakes and no GitHub egress, for the agents or the profiles; a Linux
host on Nix 2.17–2.34 needs no Nix settings (its paths are content-addressed);
a Mac, or a Linux host on Nix 2.35+, must trust the login or the cache's key
(`closureRoute`, for the package). A profile kolu built is staged by the host's
system alone (`deliverClosure`): content-addressed to a Linux host, and to a
Mac as built here — signed by no one, so a Mac takes it only when its Nix
trusts the login. Two cells, one procedure (`padiSurface` 7.0) and one spawn
layer carry it; the module is `src/agentDistro/`.

- **`agentDistro` (memory-only, `get`/`set`)** — the Agents setting
  (`{ enabled, profiles }`: the harnesses on or off, and the stack of profile
  references over them), PUSHED by the binding kolu-server on every connect
  edge and every preferences write, exactly like `newTerminalPolicy` (the push
  mechanism is `packages/server/src/padi/padiCellPusher.ts`, shared by both).
  padi never reads a reference: it only compares the setting's stack with the
  stack of the set that landed. Not on the MCP face.
- **`agentDistroStatus` (read-only)** — whether the setting's set is on THIS
  host. A set serves only while its profiles are the setting's stack, in order:
  `ready` (the package and the built profiles new terminals get, and
  `delivering` — true while kolu-server delivers a newer set for the same stack
  and this one keeps serving), `downloading` (nothing serves this stack yet;
  kolu-server has reported it is delivering it), `undelivered` (nothing serves
  and kolu-server has not said it is delivering — never read as a delivery
  under way), `error` (the delivery failed and nothing serves: its cause in
  kolu-server's words, with Nix's own line; or a landed record this host cannot
  hold, in padi's), `off`, or `unavailable` (an unbaked, from-source padi).
  Every arm about a stack names it (`profiles`), so a reader drops one padi has
  not caught up from. A changed list therefore waits for its own set: no
  terminal starts without a profile the setting names.
- **`agentDistroReceipt` (read-only)** — what this host keeps of its
  deliveries, read off the files on the host (which padi writes as each
  delivery lands): the serving package and its versions
  (`share/agent-distro/versions`), the profiles that landed with it, the last
  run (`updated` · `unchanged` · `skipped` · `failed`, with its words and who
  wrote them), and the last five history events (`history.log`, read with
  upstream's own parser). Published at boot, at every delivery report, and when
  the setting changes; readable with agents off. A later delivery that fails
  shows here and in the logs, never as an `error` status while a set serves.
- **`agentDistro.report` (procedure)** — the binding kolu-server's word on a
  delivery to THIS host (`AgentDistroDeliveryReport`, each naming the stack):
  `delivering`, `landed` (the package and the built profiles), or `failed`
  (message). A landing writes kolu's record of the set (`landed.json`, beside
  kolu's GC roots) with one atomic rename, points upstream's `current` at the
  package, stamps upstream's `last-success`, and — when anything changed —
  appends an `updated:` line to upstream's `history.log` in upstream's own
  format (`@juspay/agent-distro/update/history`'s `historyLine`, words from
  `@kolu/agent-distro/landing`'s `deliveryChanges`: upstream's `changes()` for
  the package, `juspay a1b2c3d → d4e5f6a` for a profile), so a host that also
  runs agent-distro's Home Manager module keeps ONE log. A landing naming a
  path not on this host is padi's own failure, recorded and thrown back. padi
  never retries and never runs Nix for agents — kolu-server delivers again on
  upstream's schedule, on every bind, and on the user's check. Binder-only; not
  on the MCP face.
- **Keeping it current** — kolu-server's job, not padi's: it delivers on
  upstream's schedule (02/08/14/20 UTC, retries on a failed run), whenever this
  padi binds or takes a changed setting, and when the user asks — re-reading the
  index, re-locking and rebuilding every profile. On the machine running kolu,
  a landed set wins over the floor once it exists. Only the newest delivered
  package and the newest build of each profile in the stack have a GC root
  (kolu-server writes them under `~/.local/state/kolu/agent-distro/gcroots/`
  on the host — `@kolu/agent-distro/gcRoots` — and padi removes every other
  root there: as a stack lands, all but its own, and at boot all but the set
  it serves — so a host whose agents are off still drops an older kolu's
  per-bundle roots; the directory is part of padi's bake, `gcRootsDir`): after
  an update the
  previous one can be garbage-collected under a terminal still using it, a
  limit the docs state rather than a root padi holds.
- **The spawn layer** — at each spawn (fresh, wake or restart) padi asks the SAME
  question the status answers (`newTerminalLayer`, over `assessAgentDistro`):
  only a host reading `ready` gives a layer, so a host `downloading` or in
  `error` spawns terminals with no agents. The ready set is the one kolu-server
  last landed here, else the FLOOR's package with no profile (local machine
  only). Its exact paths are stamped on the terminal record (its one `agents`
  struct — the tile pill): the package's `bin/` joins the terminal's toolchain
  AFTER kolu's own tools, riding the same `KOLU_TERMINAL_TOOLS_PATH` stamp the
  rcfile re-asserts; `AGENT_DISTRO_PLUGINS` names this kolu's `agent-plugin`;
  the built profiles' store paths are exported as `AI_PROFILE`,
  whitespace-joined in stack order — and with no profile it is not set at all.
  A running terminal never changes set, except through `lifecycle.restart`: a
  fresh PTY on the same id (same cwd, layout, parent, theme), flipped through
  sleep and wake, so it re-resolves the layer — what that means for the user
  (the conversation, a plain shell) is
  [kolu.dev/agents](https://kolu.dev/agents#restarting-a-terminal-onto-the-current-agents).
  The call answers once the new PTY is up, with the `agents` it got and whether
  it `resumed` the conversation; a kill that fails with the PTY still alive puts
  the record back on it and fails. An attach that lands in the restart's
  dormant middle waits for the new PTY rather than answering `TerminalNotFound`
  (which a client's attach loop reads as "gone" and stops on). A saved record's
  `agents` from before the one-package release is dropped by the state
  migration (`1.2.0`): the spawn that brings it back stamps it afresh.
- **The profile in effect** — once a terminal with agents is spawned and wired,
  padi runs its package's `bin/agent-distro --list --json` ONCE, in the
  terminal's resolved cwd and with its spawn env (`inEffect.ts`), and writes
  upstream's `profile` field onto the record as `agents.effective` (`{ name,
  description, source }`, named with upstream's own `nameText` / `sourceText`:
  `juspay + my-repo`; the parse is `@kolu/agent-distro/inEffect`). Upstream
  composes it — a repository's `agent-distro.nix` over the `AI_PROFILE` stack —
  and reads the built profiles without fetching; padi never re-derives it. It
  never blocks or fails the spawn: a failure or a timeout is logged and leaves
  `effective` absent (as does a launch with no profile at all), and an answer
  for an entry that was since killed, slept or re-spawned is dropped.
- **Where it lives** — `src/agentDistro/`, one module per thing that changes
  on its own clock: `bake.ts` (what the build baked), `onHost.ts` (the set this
  host serves), `layer.ts` (what a terminal spawned now gets, and its record
  stamp), `inEffect.ts` (asking agent-distro for the profile in effect),
  `deliveries.ts` (what kolu-server has reported about deliveries here, and
  landing one), `receipt.ts` (what the files on the host say), and
  `agentDistro.ts` (kolu's policy: the status, the receipt, the report).
  kolu's contract with upstream agent-distro — the state layout, the landed
  set, the history wording — is [`@kolu/agent-distro`](../agent-distro), which
  padi imports, beside upstream's own vocabulary (`@juspay/agent-distro`).
- **The bake** (`src/agentDistro/bake.ts`) — `KOLU_AGENT_DISTRO_STATE` (where
  this host keeps the package's `current`, the history log and the landed
  record, both arms), `KOLU_AGENT_DISTRO_BUNDLE` (the local floor, `default`
  wrapper only) and `KOLU_AGENT_PLUGIN_DIR` (both arms), baked by
  `@kolu/agent-distro`'s Nix half (`packages/agent-distro/default.nix`).
  (`KOLU_AGENT_DISTRO_DELIVERY` — the flake, index, cache and schedule — is
  kolu-server's alone.) The floor is read through its manifest
  (`share/kolu/agent-distro.json`), never a directory layout. Unbaked reads as
  none; a half bake, or a floor without its manifest, throws at boot.
  Every one is `KOLU_*`, so no terminal inherits them. A change to any of them
  changes the wrapper's own store path, so the agent-tools bake record
  (`agentToolsBake.ts`) already drains a same-build resident that predates it.

## The odu sibling — another daemon's surface, re-served

odu's web daemon is a per-user singleton, absent on most machines, that publishes
a board of every run it has recorded. padi does not fold that board: it RE-SERVES
odu's own surface. Two of odu's members ride padi's socket at `surface/odu/*` —
`cells.service` (who is serving, and on what origin, so a link out dials where the
daemon actually is) and `streams.checkout({ repoRoot })` (one checkout, whole:
the run it stands for, that run's work, and what ran before it). A reader
subscribes to odu's `checkout` stream exactly as odu's own board page does: same
schemas, same frames, one contract with one owner. The subscription is keyed by
the REPO ROOT it asks about, so a terminal that `cd`s re-keys onto the checkout it
moved to rather than waiting for something to re-derive a frame.

What padi supplies is a link and nothing else (`./odu.ts`) — three facts only this
file knows, and all three are odu's own values, imported rather than restated:

- **Where odu's socket is** — `serviceSocketPath()`, re-read on every dial because
  it is derived from the daemon's own environment, never remembered.
- **Whether this build may speak to it** — `admitService`, odu's comparison beside
  the version it is about, so padi never compares contract versions itself and
  cannot get the direction of that comparison backwards. A refusal is loud: logged
  at error, and carried to every reader as a FAILED subscription
  (`SurfaceUpstreamRefused`, with odu's own sentence on it) rather than as a hold
  or an absent frame. An odu this build cannot read is a different fact from no
  odu at all, so the Inspector draws a stated reason where an absent daemon draws
  nothing.
- **What "nothing to say about this checkout" is** — odu's `CHECKOUT_NONE`, handed
  to the re-serve as the member's absent frame, so a daemon that was stopped CLEARS
  a reader instead of leaving it painting the last board forever. It is deliberately
  the same frame for "odu is not running here" and "this checkout has no runs": a
  reader that cannot act on the difference should not be handed it.

Everything else belongs to the framework, which is why this module is three dozen
lines rather than a daemon-sized one. `unixSocketConnector` owns the dial, and is
the one thing that can tell `ENOENT`/`ECONNREFUSED` ("nothing is serving") from
"it broke"; `makeSession` owns the reconnect loop, the give-up budget and the
quiet `absent` steady state — probed at the ceiling, logged at debug, never ageing
into a terminal failure; `reServeSurface` owns the demand gate and the hold-open
relays. See [`@kolu/surface-remote`](../surface-remote)'s README for all three.
Nothing here ever STARTS odu: bootstrapping is `odu web`'s job.

The served contract does not vary by machine. `padiServedSurfaces` carries odu's
tags whether or not an odu daemon is installed, so a caller meets the same wire
everywhere and absence arrives as a FRAME rather than as a missing tag — a tag set
that changed with a neighbouring daemon's installation would make every client's
contract a function of the host it happened to reach. The schemas are odu's own
(`@odu/service-client`, grafted from the npins `odu` pin — see
[`@kolu/padi-client`](../padi-client)'s README for the graft).

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
