# anyforge

The forge-neutral PR kernel — what stays stable while forges vary. Leaf package (deps: `kolu-shared` types + zod + ts-pattern), browser-safe via the `anyforge/schemas` subpath. `anyagent` is the same move for agents; plan of record: `docs/atlas/src/content/atlas/anyforge.mdx` (kolu#1240).

## Modules

| Module         | Exports                                                                                | Purpose                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `schemas.ts`   | `PrInfoSchema`, `PrResultSchema`, `PrUnavailableSourceSchema`, `reasonForSource`, `prResultEqual`, … | Wire vocabulary + display helpers (browser-safe)                                          |
| `provider.ts`  | `PrProvider`, `PrGitContext`, `ForgeKind`                                              | The adapter contract — a pure `resolve(git)`, dispatched per resolve                       |
| `detect.ts`    | `detectForge`, `parseRemoteHost`                                                       | Sync, pure forge detection from the remote URL — no network probe                          |
| `subscribe.ts` | `subscribePr`, `PrWatcher`                                                             | Generic poll/dedup/pending/emit-guard loop, one watcher per terminal                       |

## Design

- **Closed `PrUnavailableSource` union.** Per-forge failure codes live here, not in adapters, because the client renders recovery instructions per code and must `match(...).exhaustive()` — a new forge is a compile error at every render site.
- **Provider = pure `resolve(git)`, chosen per resolve.** `subscribePr(providerFor, onChange)` looks the adapter up on each resolve, so a remote-URL change is a different dispatch on the next resolve — no watcher teardown/rebuild, and the git channel's synchronous `onEvent` contract is never crossed by an awaited detection.
- **Unknown forge → github, no probe.** `gh` already resolves any GitHub-host remote it's authenticated for (GHE included) and degrades to a silent `absent` elsewhere — the gh CLI *is* the fallback prober.

## Adapters

Forge adapters implement `PrProvider` against these shapes and never import each other:

- `kolu-github` — `gh pr view` spawn, stderr classification, check-rollup derivation.
- `kolu-forgejo` — Forgejo/Codeberg REST (kolu#1240 phase 1, not yet landed).
