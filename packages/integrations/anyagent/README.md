# anyagent

The agent kernel: the contracts every `kolu-<agent>` integration implements, and the algorithms that consume them. It names no agent. The per-agent data lives in each agent package, and the listing lives in `kolu-agents`.

## Entries

| Entry | Holds |
| --- | --- |
| `.` | The whole contract set: `AgentAdapter`, `AgentPlugin`, `AgentVocab`, `matchesAgent`, `agentInfoEqual`, the CLI registry and its renderers, `classifyByAwaiting`, plus the schema re-exports. |
| `./schemas` | The browser-safe half: `TaskProgressSchema`, `AgentPresenceStateSchema`, `RestoreTarget` and the vocabulary types. No `node:` imports. |

## What it owns

- **`AgentAdapter`** (`agent-adapter.ts`) — session resolution, session keys, per-session watching, and the optional `externalChanges` install. Info equality is a free function, `agentInfoEqual`, not a method.
- **`AgentVocab` and `AgentPlugin`** (`vocab.ts`, `plugin.ts`) — what an agent declares about itself: kind, display name, mark, CLI grammar, resume policy, info schema, and on the node side its adapter, transcript fetcher and env keys.
- **CLI rendering** (`agent-cli.ts`) — `buildCliRegistry`, `stableFlagTokens`, `resumeFormFor`, `resumableCommand`, `agentLaunchLine`, `willResume`.
- **Presence and progress schemas** (`schemas.ts`) — the states an agent is in before it has a readable session, and the shared task-progress shape.

## Do not break

- **Nothing executable may come from PTY bytes.** A command kolu types is rendered from the vocab, the OS-derived identity, and the live process argv. The `OSC 633;E` mark survives only as `agentNameHint`, a basename compared against known agent names.
- **`./schemas` stays browser-safe.** The client bundle imports it; adding a `node:` import breaks that.
- **A flag's arity is declared with its membership** in `stableFlags`, so a trailing prompt positional never leaks into a resumed command line.
- **`buildCliRegistry` throws on a duplicate kind.** That load-time crash is the fence.
- **The registry is passed in, never imported.** anyagent must not depend on `kolu-agents`, and `AgentPlugin`'s `Fetch` is a type parameter so it need not depend on `kolu-transcript-core` either.

## Dependencies

Depends on `@kolu/log`, `@kolu/shell-quote`, `kolu-io` (the `ProcessSnapshot` type only), `nonempty`, `effect` and `string-argv`.

Depended on by every agent integration (`claude-code`, `codex`, `opencode`, `grok`, `omp`, `pi`, `xyne`), by `kolu-agents`, and by `kolu-common`, `kolu-server`, `padi`, `padi-client` and `terminal-vocab`.

Tests: `src/agent-adapter.test.ts`, `src/schemas.test.ts`.
