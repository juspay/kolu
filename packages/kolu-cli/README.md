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
kolu snapshot <id> [--tail N] what the terminal shows now, as plain text
kolu history <id> [--lines N] the scrollback above the current screen
kolu kill <id>                end a terminal
kolu watch [id] [--json]      stream terminal changes and output activity
kolu web [flags]              the web server (the browser face)
kolu mcp [--host ssh]         serve this host's terminals to a coding agent over MCP (stdio)
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
exists to drop. The two faces that cannot honor an endpoint (`web`, which dials
no padi; `mcp`, whose adapter owns its own re-resolving local dial and so takes
`--host` only) **refuse** what they can't act on rather than ignoring it.

**Ids accept any unique prefix**, everywhere an `<id>` appears. **stdout is
data, stderr is prose** — `id=$(kolu create … )` captures the bare id while the
human trailer goes to stderr.

## The exit-code contract

The codes are user-visible and load-bearing: a driving loop branches on them,
so they live in one module (`src/exit.ts`) with a test pinning the whole matrix.
They are the codes `padi-tui` and `kaval-tui` each carried a copy of, so a loop
that branched on them keeps working against the new spelling.

| code | meaning |
| --- | --- |
| `0` | the verb did what it was asked |
| `1` | a usage error, or the padi link dropped |
| `2` | `wait` ran out of time — the condition never landed |
| `3` | `wait`'s terminal exited before reaching the condition |
| `130` | interrupted (Ctrl+C / SIGTERM / SIGHUP) |

`2` and `3` are deliberately distinct: "still alive but stuck" is retryable,
"the agent I was driving died" is not.

## Two breaking changes

1. **Bare `kolu` no longer starts the web server.** It prints the subcommand
   list and exits non-zero, so a user picks a face explicitly. With a dozen
   faces, silently booting a web server for a bare invocation is a footgun
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
- **`kolu mcp` is a pure padi client** — kolu-cli resolves the running padi's
  digest-keyed socket (or dials a remote padi over ssh with `--host`), gates the
  contract version, mounts the production `STREAM_RETRY` policy on the one
  client, and hands it to `kolu-mcp`'s serve-function. No kolu-server process is
  involved.
- **The reserved subcommand fails fast** with a named not-shipped-yet message
  (exit 1) — as does a typo'd subcommand (`kolu tuii`).
- **`--version`** reads the server's one `serverVersion` accessor (whose source
  of truth is `packages/server/package.json` — `/release` bumps it; nix reads
  the same file), so the binary and the running server can never report
  different versions.

The plan of record is the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)) — see its
amendment on subsuming the TUIs' verbs.
