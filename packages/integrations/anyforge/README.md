# anyforge

The forge-neutral PR kernel — what stays stable while forges vary, and **nothing forge-specific**. Leaf package (deps: `kolu-shared` types + zod + ts-pattern), browser-safe via the `anyforge/schemas` subpath. It is to forges what `anyagent` is to agents: the leaf names no concrete forge (`ForgeAdapter.kind` is a bare `string`, exactly like `AgentAdapter.kind`). Plan of record: `docs/atlas/src/content/atlas/anyforge.mdx` (kolu#1240).

## Modules

| Module         | Exports                                                                          | Purpose                                                                       |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `schemas.ts`   | `PrInfoSchema`, `CheckRunSchema`, `PrStateSchema`, the generic `PrResult<S>` + `PrUnavailableSourceBase`, `prResultEqual`, `prValue`, `prLabel` | Neutral wire shapes + generic result type + display/equality helpers (browser-safe) |
| `adapter.ts`  | `ForgeAdapter<S>`, `PrGitContext`                                                    | The adapter contract — `kind: string` + a pure `resolve(git)`                  |
| `subscribe.ts` | `subscribePr`, `PrWatcher`                                                         | Generic poll/dedup/pending/emit-guard loop; takes one injected `ForgeAdapter`    |

## Design

- **The leaf enumerates no forge.** `ForgeAdapter.kind` is `string`; the failure source is the open `PrUnavailableSourceBase = { provider: string; code: string }`, and `PrResult<S>` is generic over it. The **closed** `PrUnavailableSource` union and the wire `PrResultSchema` — the part that must be exhaustively `match`-ed at every client render site — are composed in the app (`kolu-common`), exactly where `AgentInfoSchema` composes the per-agent schemas. A concrete adapter's failure codes live **in that adapter** (`GhUnavailableCodeSchema` is in `kolu-github`), not here.
- **Adapter = pure `resolve(git)`, injected.** `subscribePr(adapter, onChange)` takes one `ForgeAdapter`, mirroring how `startAgentSensor` takes one `AgentAdapter`. No registry, no per-resolve dispatch, no detection in the kernel — with a single forge there is nothing to dispatch *to*. (Forge detection — which adapter resolves a given remote — is a server concern that arrives with the second adapter; see the plan note, decision D2.)
- **Generic, so it stays type-safe without naming a forge.** An adapter produces `PrResult<ItsOwnSource>` (`githubForgeAdapter: ForgeAdapter<GhUnavailableSource>`); that's a member of the app's closed union, so it's assignable to the wire `PrResult` covariantly — no cast.

## Adapters

Forge adapters implement `ForgeAdapter` against these shapes and never import each other:

- `kolu-github` — `gh pr view` spawn, stderr classification, check-rollup derivation; owns `GhUnavailableCodeSchema` (`kolu-github/schemas`).
- `kolu-forgejo` — Forgejo/Codeberg REST (kolu#1240 phase 1, not yet landed).
