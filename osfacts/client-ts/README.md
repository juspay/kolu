<!--
  Maintainers (human or agent): this README is written per the /pg skill,
  house style "code spans + structure only" — no bold, no italics; headers
  and `code spans` do the scanning. Edit it through that voice.
-->

# osfacts-client

The TypeScript face of the [osfacts](../) binary. Spawn it at a path you
supply, refuse a schema version you do not speak, and hand back typed
`P` / `L` / `U` rows. Nothing more.

```ts
import { snapshotSubtree } from "osfacts-client";

const reading = await snapshotSubtree(process.env.OSFACTS_BIN!, [4242]);
// reading.procs · reading.ports · reading.unreadable
```

No `@kolu` imports. No npm runtime dependencies — only `node:child_process`
and friends — so a second consumer can pin this package without dragging
kolu's monorepo graph. kolu (via padi) is the first consumer; drishti is
the next (replacing a hand-rolled `lsof` path). Policy about what a bind
*means* (scope, fold, blindness) lives with the consumer, not here.

## What it does

- Spawn `osfacts snapshot --roots … --procs --ports` (or `--pids`) at a
  supplied absolute binary path.
- Gate on `V 1` — a mismatched format fails loudly.
- Parse every row; a line it cannot read is an error, never a skip.
- Return the raw tables: process rows, listener rows with network-order
  hex addresses, unreadable rows with errno.

## What it does not

- Read `KOLU_OSFACTS_BIN` (or any env) — the caller owns the path.
- Classify addresses into any / loopback / interface.
- Fold ports, rank scopes, or decide that a U row blinds a terminal.
- Depend on zod, pino, or anything that is not a Node built-in.
