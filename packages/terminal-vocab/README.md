# @kolu/terminal-vocab

**The browser-safe terminal vocabulary.** The shared Effect Schema family and pure
projections that describe _what a terminal is working on_ — read on both sides of
the node/browser line: `@kolu/padi` (the per-host terminal daemon) folds and
serves it server-side, and the client reads it to paint the dock. It carries no
runtime, no sensors, no I/O — just the words a `TerminalSnapshot` is spelled in.

Before L7 this package was `@kolu/terminal-workspace` and also held the node-only
producer (sensors · fold · fs/git endpoint). Those had exactly one consumer —
padi — so L7 folded them into `packages/padi/src/terminalWorkspace/`; what remains
here is the shared leaf, renamed to say what it now is.

## Entry points

The export map is the boundary — every entry is **browser-safe**:

| Entry | What |
| --- | --- |
| `./schema` | the `TerminalSnapshot` / `AgentMemory` / `AgentInfo` / `TerminalId` / `RestoreTarget` / `ProcessRss` schemas plus the `RepoChangePulse` / `FsFileInput` / `FsReadFileTextOutput` fs/git wire schemas `@kolu/padi-client/surface` composes. Re-exports the common port *types* used on the wire (`PortInfo`, `foldPorts`, …) and adds the two pieces that ARE domain: `TerminalPorts`' `known`/`unknown` two-way, `portReach`, and the per-frame comparisons the wire's own records are deduped with (`portsEqual`, `gridsEqual`) |
| `./ports` | the port vocabulary leaf itself (`PortInfo`, `PortScope`, `PortFamily`, `foldPorts`, `isTcpPort`, …) — Effect Schema only, no sensors. Prefer this entry when you need a symbol that is not re-exported on `./schema` |
| `./agentProjection` | the pure agent-status projection (`agentBucket` · `agentPaintClass` · `agentUrgency` · `alertClass`) over a `TerminalSnapshot` |
| `./duration` | the compact-duration LADDER (`compactDelta` — sec<60 / min<60 / hr<24 / else, with an untrustworthy delta answered `{ kind: "unknown" }` rather than clamped to zero) and the two phrases kolu says with it: `agoPhrase` ("5m ago", "just now" under a minute, empty for never-observed) and `compactPhrase` ("45s", "20h"). `now` is always a PARAMETER — nothing here reads a clock, because a ticking `now` is ambient app state whose cadence the consuming app owns |
| `./attentionTransitions` | the pure attention-edge folds shared by the client and padi |
| `./terminalKey` | the canonical `(group, label)` identity-and-display projection (`terminalKey` · `computeTerminalKeys`) and the two path helpers it is built from (`cwdBasename` · `shortenCwd`). Moved down from `kolu-common` so `@kolu/padi` can caption a screenshot with the SAME projection the client paints a tile with, instead of hand-rolling a second one |

## Who reads it

- **`@kolu/padi`** (node) — folds each terminal's observation stream into a
  `TerminalSnapshot`, composes its record, and serves it on `padiSurface`.
- **the client** — via `kolu-common`'s `surface` re-export, to render the dock /
  state-pip from the same vocabulary the daemon serves.
- **`@kolu/solid-statepip`** — the `agentPaintClass` projection for its variants.

## What it knows nothing about

No PTY (that's [`kaval`](../kaval/)), no host store, no orchestration (spawn ·
adopt · the registry are `@kolu/padi`'s), and no app concepts — a
`TerminalSnapshot` has no terminal `location`, theme, or layout; those belong to
whatever app embeds it. It reaches only the vendor-neutral schema sources it
builds on (`anyforge` for PRs, `kolu-git` for git/fs types, the per-agent
packages for agent-state shapes).
