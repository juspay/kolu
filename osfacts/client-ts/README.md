<!--
  Maintainers (human or agent): this README is written per the /pg skill,
  house style "code spans + structure only" — no bold, no italics; headers
  and `code spans` do the scanning. Edit it through that voice.
-->

# osfacts-client

The TypeScript face of the [osfacts](../) binary. Spawn it at a path you
supply, refuse a schema version you do not speak, and hand back typed
`P` / `M` / `S` / `C` / `L` / `U` / `E` and host rows. Nothing more.

```ts
import { snapshotSubtree } from "osfacts-client";

const reading = await snapshotSubtree(process.env.OSFACTS_BIN!, [4242]);
if (reading.errors.length > 0) {
  // This consumer rejects partial source failures; another may render them.
  throw new Error(JSON.stringify(reading.errors));
}
// reading.procs · reading.cpuTimes · reading.ports · reading.unreadable
```

No `@kolu` imports. No npm runtime dependencies — only `node:child_process`
and friends — so a second consumer can pin this package without dragging
kolu's monorepo graph. kolu (via padi) is the first consumer; drishti is
the next (replacing a hand-rolled `lsof` path). Policy about what a bind
*means* (scope, fold, blindness) lives with the consumer, not here.

## What it does

- Spawn `osfacts snapshot --roots … --procs --ports` (or `--pids`) at a
  supplied absolute binary path.
- Gate on `V 2` — a mismatched format fails loudly.
- Parse every row; a line it cannot read is an error, never a skip.
- Return partial facts when one requested source is blind. The process exits
  successfully when other facts survived, keeps the source failure in
  `reading.errors`, and leaves reject-versus-render policy to the caller.
- Return the raw tables: process identity, RSS, start time, and cumulative
  user-plus-system CPU microseconds; listener rows with explicit
  claimed/unclaimed status and network-order hex addresses; host gauges and
  cumulative counters; unreadable facets; and source errors.

## What it does not

- Read `KOLU_OSFACTS_BIN` (or any env) — the caller owns the path.
- Classify addresses into any / loopback / interface.
- Fold ports, rank scopes, or decide that a U row blinds a terminal.
- Depend on zod, pino, or anything that is not a Node built-in.
