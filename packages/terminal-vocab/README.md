# @kolu/terminal-vocab

**The browser-safe terminal vocabulary.** The shared zod-schema family and pure
projections that describe _what a terminal is working on_ — read on both sides of
the node/browser line: `@kolu/padi` (the per-host terminal daemon) folds and
serves it server-side, and the client reads it to paint the dock. It carries no
runtime, no sensors, no I/O — just the words a `TerminalSnapshot` is spelled in.

Before L7 this package was `@kolu/terminal-workspace` and also held the node-only
producer (sensors · fold · fs/git endpoint). Those had exactly one consumer —
padi — so L7 folded them into `packages/padi/src/terminalWorkspace/`; what remains
here is the shared leaf, renamed to say what it now is.

## Entry points

The export map is the boundary — both entries are **browser-safe**:

| Entry | What |
| --- | --- |
| `./schema` | the `TerminalSnapshot` / `AgentMemory` / `AgentInfo` / `TerminalId` / `RestoreTarget` / `ProcessRss` schemas plus the `RepoChangePulse` / `FsFileInput` / `FsReadFileTextOutput` fs/git wire schemas `@kolu/padi/surface` composes. It owns the port vocabulary (`PortInfo`, `PortScope`, `PortFamily`, `foldPorts`, … in `./ports.ts`) and adds the two pieces that ARE domain: `TerminalPorts`' `known`/`unknown` two-way, and `portReach`, which decides how a port becomes reachable |
| `./agentProjection` | the pure agent-status projection (`agentBucket` · `agentPaintClass` · `agentUrgency` · `alertClass`) over a `TerminalSnapshot` |

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
