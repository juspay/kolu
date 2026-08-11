# kolu-cli

The `kolu` binary — the product's entry point and its **composition root**
(the one package allowed to import everything). It owns the subcommand
dispatch, the shared endpoint flags, and the padi connect layer, and boots
whichever face the user asked for; the faces themselves live elsewhere.

`kolu` is also the **one terminal CLI**. Its scripting verbs subsume what
`padi-tui` and `kaval-tui` served, so a user — human or agent — drives kolu
terminals with a single command. Every verb is a **pure padi client**:
`padiSurface` already carries the union of both TUIs' needs
(`lifecycle.create`/`sendInput`/`kill`/`resize`, `screen.text`/`history`, the
`terminalAttach` stream, the `terminalExit` event), so verb parity costs **no
kaval dependency** here and padi stays the only daemon a face speaks to.

```
kolu                          print the subcommand list and exit non-zero
kolu ls [--json]              the roster — ID · STATE · REPO·BRANCH · PR · AGENT · FOREGROUND
kolu create [flags] [-- argv] spawn a terminal; prints the new id on stdout
kolu send <id> …              type text, or a named key with --key
kolu wait <id> --until <cond> block until output settles/matches, or the agent's state lands
                              [--settled <ms>] also require output quiet; [--snapshot N] stamp the screen
kolu debrief <id>             the composed protocol: wait until the turn is over AND quiet, print the screen
kolu snapshot <id> [--tail N] the terminal's rendered text — use --tail N for "what's on screen"
kolu history <id> [--lines N] the scrollback above the current screen
kolu kill <id>                end a terminal
kolu watch [id] [--json]      stream terminal changes and output activity
kolu web [flags]              the web server (the browser face)
kolu mcp [--socket|--state-root|--host]
                              serve a padi's terminals to a coding agent over MCP (stdio)
kolu tui                      reserved — the terminal canvas (a later PR)
```

`padi-tui` and `kaval-tui` still ship and still work; they retire in a later
PR. There is **no `kolu attach`** yet — for interactive attach the browser is
the face, with `kaval-tui attach` as the terminal-side fallback.

## The shared endpoint flags — position-independent by construction

Every verb takes the same three, **mutually exclusive** (naming two is a
contradiction to refuse, not a preference to resolve):

| flag | which padi |
| --- | --- |
| *(none)* | autodiscover — and inside a kolu terminal `$PADI_SOCKET` is already stamped, so an agent driving its siblings passes nothing |
| `--socket <path>` | that exact padi socket |
| `--state-root <dir>` | the padi keyed to that state-root (dev/e2e, whose digest you don't want to compute) |
| `--host <user@host>` | a padi on another machine, over ssh |

They are declared on the **root** command as Effect CLI *shared* flags, so they
parse on **either side of the verb name**: `kolu --host box create` and
`kolu create --host box` are one parse. A flag declared on a subcommand only
parses after that subcommand's name — the positional straitjacket this CLI
exists to drop. **`kolu mcp` honors all three** — `--socket` / `--state-root` /
`--host` — exactly as the nine verbs do, because its dial resolves through the
same `localPadiSocket` policy they do (`kolu mcp --state-root .kolu-dev/padi`
points an agent at a dev kolu). The ONE face left with anything to refuse is
`web`, which dials no padi at all: it **refuses** what it can't act on rather
than ignoring it. Even on `mcp` the two rules that are about the *flags* still
bite — one transport at a time, and never an empty value.

**Ids accept any unique prefix**, everywhere an `<id>` appears. **stdout is
data, stderr is prose** — `id=$(kolu create … )` captures the bare id while the
human trailer goes to stderr.

## The exit-code contract

The codes are user-visible and load-bearing: a driving loop branches on them,
so they live in one module (`src/exit.ts`), with `src/exit.test.ts` pinning the
whole matrix — each arm read back through `Runtime.getErrorExitCode`, the exact
lookup the run edge's teardown performs, so a renumbered arm fails a test rather
than a user's script. They are the codes `padi-tui` and `kaval-tui` each carried
a copy of, so a loop that branched on them keeps working against the new
spelling.

| code | meaning |
| --- | --- |
| `0` | the verb did what it was asked |
| `1` | a usage error, or the padi link dropped |
| `2` | `wait` ran out of time — the condition never landed |
| `3` | `wait`'s terminal exited before reaching the condition |
| `130` | interrupted — Ctrl+C (SIGINT) or SIGTERM |

`2` and `3` are deliberately distinct: "still alive but stuck" is retryable,
"the agent I was driving died" is not.

`SIGINT` and `SIGTERM` are the **only** two signals in that row, because
`NodeRuntime.runMain` installs handlers for exactly those and turns each into an
interrupt of the main fiber. Anything else — `SIGHUP`, `SIGQUIT` — keeps Node's
own default disposition: the process dies on the signal and the shell reports
`128 + signum` (129 for a SIGHUP), never 130. Listing a signal here that nothing
intercepts would send a driving loop watching for a code kolu never writes.

## Two breaking changes

1. **Bare `kolu` no longer starts the web server.** It prints the subcommand
   list and exits non-zero, so a user picks a face explicitly. With twelve
   subcommands, silently booting a web server for a bare invocation is a footgun
   rather than a convenience. The server is **`kolu web`**.
2. **`kolu web --host <addr>` is now `kolu web --bind <addr>`.** `--host` is a
   shared flag meaning "which padi to reach" across the whole binary, and Effect
   CLI refuses a parent/child flag collision outright, so one name had to give;
   renaming the web-only one leaves `--host` a single idea.
   `--port`/`--tls`/`--tls-cert`/`--tls-key`/`--verbose` are unchanged.

## `wait` — one verb, three condition forms

`--until` takes `idle:<ms>` (raw output quiescence — agent-agnostic, works on
any terminal), `match:<regex>` (new output matched), or a comma list of padi's
agent buckets `working` / `awaiting` / `waiting` (precise — it *distinguishes*
"asking you" from "finished" — but only for a terminal whose agent padi
detects). This is the merge of `kaval-tui wait --until idle:/match:` and
`padi-tui wait --until <buckets>` into one verb; the two done-signals stay two
*forms*, because they genuinely read different things.

### …and two modifiers, because a driving loop cannot close its own races

```
kolu wait <id> --until awaiting,waiting --settled 15000 --snapshot 40
```

- **`--settled <ms>`** is a **conjunct on the condition**: met means the
  condition holds *and* no output byte has arrived for `<ms>`. Bytes moving keep
  the wait open; a condition that stops holding — an agent's bucket dropping
  back to `working` — re-enters it. It composes with all three forms
  (`match:DONE --settled 2000` is equally meaningful).
- **`--snapshot <N>`** is an **enrichment of the payload**: the met carries the
  last `N` rendered screen lines. In plain mode that block *is* stdout (so
  `kolu wait … --snapshot 40 | grep MARK-` works) with the met trailer on
  stderr; under `--json` it is the frame's `screen` key.

Each is useful alone — settle-without-snapshot for a trustworthy done-signal,
snapshot-without-settle for "the screen at any turn boundary" — and neither
changes the outcome arms or the exit codes: a `--settled` wait whose terminal
never goes quiet is a plain **timeout**.

They exist because the three-call loop they replace has holes only the daemon
side can close. An orchestrator used to run `wait --until awaiting,waiting`,
then `wait --until idle:15000`, then `snapshot --tail 40` — and output can move
between the first and the second, while the screen the third reads is not the
screen the second settled on. Evaluated together against **one** live
subscription, there is no gap to race, and the screen on a met is one taken
during the same unbroken stretch of quiet that met the condition (a read the
terminal moves under is discarded and retaken). The failure that motivated it:
`--until awaiting,waiting` fired on an agent whose main loop had ended its turn
while a subagent was three minutes into a deliberate plan, and the nudge that
followed preempted competent in-flight work.

## `debrief` — the protocol as one verb

```
kolu debrief <id> [--quiet <ms>] [--tail <N>] [--timeout <ms>] [--json]

  ≡  kolu wait <id> --until awaiting,waiting --settled <quiet> --snapshot <tail>
      --quiet   quiescence window, default 15000
      --tail    screen lines in the payload, default 40
```

That invocation is the step every driving orchestrator should make, and **each
flag forgotten re-opens a live failure mode** — drop `--settled` and you nudge
an agent whose subagent is still running; drop `--snapshot` and you act without
reading what the worker believes happened. So the protocol is baked into a name:

```sh
kolu debrief 4bba     # blocks until the worker's turn is over AND quiet;
                      # stdout is what its screen says — judge, then act
```

It is **definitional and nothing more**: it expands to the `wait` above and
inherits its outcome contract, exit codes, `--json` frame, and output rule — it
has no logic of its own, so there is no second face to drift. (Precedent: bare
`kolu` was the documented alias of `kolu web`. A CLI that just retired two
near-duplicate TUIs earns a new verb only if the verb *can't* diverge.) Its
vocabulary is reused too: `--tail` is `snapshot`'s flag, `--quiet` is the
sugared spelling of the `--settled` primitive.

## `snapshot` — the whole rendered buffer, and why `--tail` is the read you want

A bare `kolu snapshot <id>` prints padi's `screen.text` verbatim: the terminal's
**entire rendered buffer — scrollback and viewport together**, which on a
long-running agent is thousands of lines, not a screenful. It is not "what the
terminal shows now", and calling it that would be the kind of small lie a driving
loop pays for at 3am.

`--tail N` is the read that answers "what's on screen": the last N lines with the
buffer's trailing run of blank rows dropped first (a rendered buffer ends in the
empty viewport below the cursor, so a naive `snapshot | tail -8` hands you eight
blank lines). It is deliberately the only bounding knob — there is **no
`--viewport`**, because padi's wire reports no terminal's grid size, so "the
viewport" is not a thing this transport can express and approximating it
client-side would be a silent lie about which lines you are looking at. The same
shape as the MCP face's `screen_text { tail }`, so the two faces have one
contract between them. Older-than-the-screen output is `kolu history`'s job.

## Boundaries

It owns dispatch, the endpoint policy, and the padi connect layer — nothing
else: no server, web, or terminal state lives here, and no domain logic. A
face's behavior is entirely its own package's to own (`kolu-server` for the web
face, [`kolu-mcp`](../kolu-mcp/README.md) for the agent face, the future `tui`
package for the canvas); the verbs render and read through `@kolu/padi`'s own
`render`/`read`/`dial` entries rather than reimplementing them. Precisely
because a composition root *may* import everything, this boundary is what keeps
it from re-accreting scope.

- Each face's implementation is a **dynamic import inside its handler**, so
  `kolu mcp` never touches the web server's module graph, a terminal verb loads
  neither, and a reserved face fails fast having loaded nothing.
- **`kolu mcp` is a pure padi client** — kolu-cli resolves the padi its endpoint
  names (the digest-keyed local socket, or a remote padi over ssh with
  `--host`), gates the contract version on the handshake, and hands the one
  client to `kolu-mcp`'s serve-function. No kolu-server process is involved.
- **There is no client-level retry mount, deliberately** (`src/connect.ts`'s
  header is the long version). The restart discipline is a LAZY dial the MCP
  adapter re-invokes: every redial re-resolves the socket fresh — so a dead
  registration is dropped rather than a cached path re-used — and `connectPadi`'s
  hello/compat gate proves the new generation speaks our contract, never
  retry-same-path-blind. The reconnect fence is a `Stream` combinator each
  stream's CONSUMER applies (`fenceStream` / `unenrolledStreamCall` — padi's own
  watch kit does, as do the Solid bridge and surface-mcp's pusher), not a policy
  threaded through the call, so there is no client proxy here at all.
  Re-mounting one would be a no-op wearing a policy's clothes: the fence retries
  `RpcClientError` and nothing else, and both of this package's transports are
  reconnect-free by construction — a unix-socket or stdio link dies with its
  pipe and mints `SurfaceStdioTransportClosed`, which the fence refuses on
  purpose. So a dead transport surfaces as the tool call's error and the adapter
  redials. That redial IS the discipline.
- **The reserved subcommand fails fast** with a named not-shipped-yet message
  (exit 1) — as does a typo'd subcommand (`kolu tuii`).
- **`--version`** reads the server's one `serverVersion` accessor (whose source
  of truth is `packages/server/package.json` — `/release` bumps it; nix reads
  the same file), so the binary and the running server can never report
  different versions.

The plan of record is the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)) — see its
amendment on subsuming the TUIs' verbs.
