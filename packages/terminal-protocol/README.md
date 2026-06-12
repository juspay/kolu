# @kolu/terminal-protocol

The one home for Kolu's **VT/device-query protocol policy** — everything that must stay in lockstep when "how Kolu's terminals speak the wire protocol" changes, pulled out of the packages that merely *apply* it. A zero-runtime-dependency leaf importable from the browser bundle, the pty-host, and the CLI alike.

It exists because that policy was one concept fragmented across four packages — the suppression grammars in `kolu-common`, the forward/drop rule inline in `pty-host`, the reset list and paste bytes in `pty-tui`, all held in lockstep by prose comments. The fragmentation became visible exactly when the second terminal client (kolu-tui `attach`) landed: the browser may not depend on `@kolu/pty-host` (native closure, layering), yet both clients and the server must agree on every table. A leaf package both sides can import is the receptacle that dissolves the cross-references.

## The protocol, in one picture

```
              PTY child writes a device query (DA1, DSR, XTVERSION, OSC 11 …)
                                      │
                     headless xterm mirror (in kolu-server)
                          answers it?  ──────────────┐
                              │ yes                   │ no (colour, window size)
                  shouldForwardHeadlessReply          │
                   CSI/DCS → forward to child         │  NOBODY answers through
                   OSC     → drop                     │  kolu — uniform silence,
                              │                       │  programs use timeouts
        meanwhile, BOTH mirroring clients ALSO answer the query locally:
        browser xterm (theme, window) · the user's real terminal (attach)
                              │
                isTerminalQueryResponse / createTerminalResponseStripper
                   suppress the duplicate before it reaches the PTY
```

Every suppressed query class sits in exactly one arm — **answered** (one answerer: the headless) or **uniformly silent** (zero answerers) — never in a state where a blocking TUI waits forever. That matrix is **data** here and is executed against a real headless by `kaval`'s device-query contract tests, so policy and implementation cannot drift.

## Modules (one per concern)

| Module | Owns | Consumers |
| --- | --- | --- |
| `responseFilter` | The query-reply grammars (CSI / OSC-colour / DCS) + two suppression entry points: `isTerminalQueryResponse` (whole-payload, for xterm `onData` — one discrete event per call) and `createTerminalResponseStripper` (streaming, boundary-aware, for raw tty reads where replies split/coalesce). | browser `Terminal.tsx` · kaval-tui `attach` |
| `headlessReplies` | `shouldForwardHeadlessReply` — the server-side forward/drop policy for replies the headless mirror generates. | `kaval` |
| `deviceQueries` | `ANSWERED_DEVICE_QUERIES` / `SILENT_DEVICE_QUERIES` — the matrix as data. | `kaval` contract tests |
| `bracketedPaste` | The `?2004` paste delimiters (`ESC [200~` / `ESC [201~`). | kaval-tui escape scanner · kolu-server paste injection |
| `snapshotReset` | `SNAPSHOT_TTY_RESET` — the reciprocal reset for every mode a replayed `@xterm/addon-serialize` snapshot can switch on. **Audit on every xterm/serialize bump.** | kaval-tui `attach` restore |

What deliberately does *not* live here: the ssh-style `~.` escape state machine (an attach-control concern, `kaval-tui/src/escape.ts` — it imports only the paste markers), the OSC 7/2/633 *emission* hooks (`packages/integrations/pty` — coupled to shell-rc mechanics), and the key-input synthesis in the browser (UI-coupled).

## Invariants the package carries

- **One answerer or none.** A new suppressed class in `responseFilter` MUST land in one arm of `deviceQueries` (and thereby in the pty-host contract tests) before it ships — the failure mode is a TUI blocking forever on a query nobody answers.
- **OSC 52 (clipboard) is NOT suppressed**: only the browser can answer it; its reply must reach the PTY.
- **staleKey participation.** This package is hashed into `kaval`'s build id (`default.nix`'s `kavalSrc`, pinned by `buildId.closure.test.ts`): a protocol change here is observable daemon behaviour, so it must flip the daemon-staleness key.
- **Browser-safe by tree-shaking.** Tables and predicates are plain strings; the one byte-level member (the streaming stripper, `Buffer` in) is Node-side only and `sideEffects: false` keeps it out of the browser bundle.

Design history: the Phase 2 review trail on [juspay/kolu#1255](https://github.com/juspay/kolu/pull/1255) and the kolu-tui design note [`pty-daemon-tui`](../../docs/atlas/src/content/atlas/pty-daemon-tui.mdx).
