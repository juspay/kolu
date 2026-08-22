# @kolu/surface-cli

Project any [`@kolu/surface`](../surface) as command-line verbs, so a person, a
script, or a cron job drives your surface from a shell. The argv sibling of
[`@kolu/surface-mcp`](../surface-mcp): the same surface, the same default-deny
allowlist, the same hand-authored verb table, and the same flat names — so a
verb cannot mean one thing to an agent and another to a terminal. Procedures
become **verbs**; cells, collections, streams and events become **readable
members** (`get`, `keys`, `watch`).

```ts
import { surfaceCommands } from "@kolu/surface-cli";
import { Command } from "effect/unstable/cli";

const verbs = surfaceCommands({
  surface,
  expose: { load: "resource", "proc.kill": "tool" },
  endpoint: { flags, resolve },
  info: { name: "example" },
});

export const cli = Command.make("example").pipe(Command.withSubcommands(verbs));
```

`surfaceCommands` is a pure function to **values** — your binary mounts them and
keeps the run edge. It claims four subcommand names beside your own (`get`,
`keys`, `watch`, `list` — exported as `READER_NAMES`), so mount it under a
parent of its own (`app surface …`) or check your names against them. stdout is data (JSON, ndjson when streamed), stderr is prose,
and the exit code says which happened: `0` done · `1` the verb's declared
refusal · `2` a usage error that never left the process · `3` nothing serving ·
`130` interrupted.

Part of the kolu monorepo — `"@kolu/surface-cli": "workspace:*"`.

## Docs

- How-to — [Expose a surface to a terminal](https://kolu.dev/surface/expose-to-cli)
- Reference — [@kolu/surface-cli](https://kolu.dev/surface/ref-surface-cli)
