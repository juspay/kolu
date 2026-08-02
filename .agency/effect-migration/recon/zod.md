# Zod inventory — kolu monorepo (`/home/srid/code/kolu/.worktrees/effect`)

## Scale

| Metric | Count |
|---|---|
| `package.json` declaring `"zod": "^4.3.6"` | **29** (all packages; no root dep, no version drift) |
| `.ts`/`.tsx` files importing zod | **117** (52 production, 53 test/`.test-d`/`testlib`, 12 example/demo) |
| `export const *Schema` (production) | **192** |
| `z.infer<...>` sites (production) | **209** |
| Zod usage outside `packages/` | **none** (one prose mention in `website/src/content/blog/surface-framework.mdx`) |

No zod-adjacent third-party tooling at all: no `zod-to-json-schema`, no openapi generator, no form library, no `zodResolver`. JSON Schema is produced by **zod 4's own `z.toJSONSchema`** in one file.

## The dominant coupling: oRPC

Zod is not used standalone — it is the schema currency of **`@orpc/contract` / `@orpc/server` / `@orpc/client` v1.13.13**, declared in 13 packages and imported by **94 files**. Every `oc.input(schema).output(schema)` call in `@kolu/surface`, `@kolu/surface-map`, `padi`, `kaval`, `kolu-server` passes a Zod schema straight into oRPC. Any Effect Schema migration is gated on oRPC accepting Effect schemas (Standard Schema v1) *and* on the type-level inference (`z.input`/`z.output` → `Schema.Encoded`/`Schema.Type`) surviving the swap. **No `effect` / `@effect/*` dependency exists in the repo yet.**

---

## Production files

### Framework core — `@kolu/surface`

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/surface/src/define.ts` (1225L) | `ZodType<T>` as the universal generic bound; `z.object`, `z.array`, `z.tuple`, `z.discriminatedUnion`, `z.literal`, `z.void`, `z.infer` | **The framework kernel.** `CellSpec`/`CollectionSpec`/`StreamSpec`/`EventSpec`/`ProcedureSpec` all carry `ZodType<T>`; builds oRPC contracts; `collectionDeltasSchema(keySchema, schema)` is the wire delta envelope (`snapshot`/`delta` discriminated union with `z.tuple([key, value])` entries); `SurfaceTypes<S>` derives every consumer type via `z.infer` | **WIRE — critical.** The delta envelope shape (`{kind:"snapshot",entries:[[k,v]]}` / `{kind:"delta",upserts,removes}`) travels over sockets/ssh between processes of different builds |
| `packages/surface/src/solid/surfaceClient.ts` (1513L) | `z.input<In>` / `z.output<Out>` **split** | `BoundProcedure` types the callable's arg as the *accepted* wire type and the result as the *parsed* type. Explicitly documented as matching oRPC's `.input()` behaviour | Type-level only, but the trickiest inference site in the repo |
| `packages/surface/src/identity.ts` | `z.discriminatedUnion`, `z.literal`, `z.object`, `z.string().min(1)`, `z.number` | `BuildCommitSchema`, `BakedIdentitySchema`, `ServedIdentitySchema` — build-identity handshake | **WIRE** (hello frame across ssh) |
| `packages/surface/src/clockNow.ts` | `z.object({epochMs:z.number()})` | `ServedClockNowSchema` — clock-offset probe | **WIRE** |
| `packages/surface/src/liveness.ts` | `z.object` | liveness probe contract | **WIRE** |
| `packages/surface/src/index.ts`, `mirrorRemoteSurface.ts`, `server.ts` | re-export / type-only (their `.catch(` hits are Promise.catch, not zod) | — | — |

### `@kolu/surface-map`

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/surface-map/src/define.ts` (584L) | **`.brand("MembershipId")`**, `.min(1)`, `.parse`, `z.discriminatedUnion`, `z.literal`, `z.object`, `z.array`, `z.string`, `z.number`, `z.nullable`, `z.optional`, `z.void`, `z.undefined`, `z.infer`; **runtime introspection of `.def.type`** (line 268) | Keyed map of remote surfaces. `MembershipIdSchema` is a branded string (brand = compile-time nominality, `.min(1)` = runtime gate). `keySchema.parse` is the sole producer of validated keys. Folds `{mapKey, input}` envelope into every member's input | **WIRE — critical.** Void members must emit **no `input` key at all** (documented zod-version hazard: 4.3.6 accepted a missing key for `z.void()`, ≥4.3.7 rejects it — this broke drishti). The `.def.type` probe detects void/undefined members |
| `packages/surface-map/src/evidence.ts` | `z.ZodType<T>` **annotation** on a const, `z.enum`, `z.object`, `z.string`, **`.readonly()`** | `EvidenceLineSchema`, `FailureEvidenceSchema` — failure evidence carried on the wire | **WIRE** |
| `packages/surface-map/src/server.ts` (773L) | `ZodType`, `.parse`, `.min`, `z.infer`, `z.string` | Server half: mints membership ids, re-validates keys off the wire (P5 gate) | **WIRE** |
| `packages/surface-map/src/client.ts` (891L), `scoped.ts` | `ZodType`, `z.infer`, `.parse` | Type plumbing + client-side key decode | — |

### `@kolu/surface-remote`, `@kolu/surface-app`, `@kolu/surface-daemon`

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/surface-remote/src/connection.ts` | `z.discriminatedUnion("phase")`, `z.enum`, `z.literal`, `z.array(...).readonly()`, `.nullable`, `.safeParse`, `z.ZodType`, `z.infer` | `ConnectionInfoSchema` — the mirror-seam connection cell (documented in `docs/atlas/.../pulam-web-mirror-health.mdx` as a browser-safe zod+surface leaf shared with drishti/pulam-web) | **WIRE + cross-repo.** drishti consumes this shape |
| `packages/surface-remote/src/agentBinaryCache.ts` | `z.object`, `z.array(z.string().trim().min(1)).min(1)`, `.safeParse`, **`z.prettifyError`** | Validates the Nix-baked substituter/trusted-key declaration; throws loudly if empty | **Build-baked config.** `z.prettifyError` has no direct Effect equivalent (use `TreeFormatter`) |
| `packages/surface-remote/src/serveHostMap.ts` | `z.ZodType`, `z.infer` | generic plumbing | — |
| `packages/surface-app/src/surface.ts` | `z.ZodType<T>`, `z.object`, `z.infer` | `ServerProbeSchema`; descriptor typing | **WIRE** (probe) |
| `packages/surface-daemon/src/controlCore.ts` | `z.object`, `z.string`, `z.number`, `.optional`, `z.infer` | `ControlCoreHelloSchema` — daemon hello frame | **WIRE** |

### `@kolu/surface-mcp` (JSON-Schema bridge)

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/surface-mcp/src/jsonschema.ts` (217L) | **`z.toJSONSchema(schema, {target:"draft-2020-12", io:"input", unrepresentable:"any", reused:"inline", cycles:"ref"})`**, `z.date`, `z.array`, `z.string`, `.default` | Converts every surface schema into an MCP tool `inputSchema`; ~100 lines of glue that dereferences `$ref`/`$defs`, drops root self-refs, enforces top-level `{type:"object"}`. Header explicitly notes option defaults are a "zod-version seam" | **Highest-risk single conversion.** Effect Schema's `JSONSchema.make` has different option semantics, different `$defs` behaviour, and no `io:"input"` equivalent. Snapshot-tested (`jsonschema.test.ts`) |
| `packages/surface-mcp/src/expose.ts` | `.safeParse`, `z.object`, `z.string`, `z.number`, `z.void` | Validates incoming MCP tool args before dispatch | Wire (MCP protocol) |
| `packages/surface-mcp/src/server.ts` (817L) | `.parse`, `.safeParse`, `z.boolean/enum/literal/number/string/void` | MCP server dispatch; unwraps `args.value` for non-object inputs | Wire |
| `packages/surface-mcp/src/tools.ts` | `import type { ZodType }` only | `BespokeTool<I,O>.input?: ZodType<I>` | Type-only |

### App contracts — `kolu-common`, `padi`, `kaval`, `kolu-server`, `terminal-vocab`

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/common/src/surface.ts` (1028L) | `z.object/array/enum/union/discriminatedUnion/literal/string/number/boolean/null`, `.extend`, `.omit`, `.partial`, `.optional`, `.nullable`, `.int`, **`.refine`** (line 592, cross-field: at least one of `surfaceVersion`/`buildCommit`/`convergence` non-null), `.shape` reflection (line 689 `FORWARD_KEYS`), `z.infer` | The app's main surface: `PreferencesSchema`, `RightPanelPrefsSchema`, `PreferencesPatchSchema` (omit+partial+extend), `ViewerModeSchema`, `ColorSchemeSchema`, `ShuffleBehaviorSchema`, `NewTerminalThemeSchema`, `DaemonInventorySchema`, `PadiConvergenceSchema`, `InstanceKeySchema`, `KoluForwardSchema`, `TaskProgressSchema`, `ProcessMemorySchema`, `PadiLinkSchema` | **DISK + WIRE.** `PreferencesSchema` and `ViewerModeSchema` are fields of the on-disk `PersistedStateSchema` |
| `packages/common/src/hostKey.ts` | `z.discriminatedUnion("kind")`, `z.literal`, `z.string().min(1)`, **3× `.refine`**, `.brand` mentioned-but-rejected, `z.infer` | `HostKeySchema` (`{kind:"local"}` \| `{kind:"remote",target}`); **`PersistedHostsSchema`** = array of encoded host-key strings with refinements: canonical-encoding check, "local must never be persisted", no duplicates | **DISK — critical.** The `hosts` field of the conf store; encoded-string format (`encodeHostKey`) must stay byte-identical |
| `packages/common/src/contract.ts` | `z.object`, `z.string`, `z.void`, `.nullable`, `z.infer` | `PwaIdentitySchema`, `ServerInfoSchema` (oRPC contract) | **WIRE** |
| `packages/common/src/surfacesWithPadi.ts` | `z.discriminatedUnion("cause")`, `z.literal`, `z.object`, `z.string`, **`.shape` spread** (line 148), `z.infer` | `PadiEntryFailureSchema`, `SkewVersionPairSchema` composition | **WIRE** |
| `packages/padi/src/vocab.ts` (969L) | `z.discriminatedUnion`, `z.enum`, `z.literal`, `z.object`, `z.array`, `z.number`, `z.string`, **`z.never().optional()`** (×11, to make cross-arm fields unspellable), `.merge` (×14), `.pick`, `.nullable().default(null)`, `.min`, `.optional`, `.parse`, `.safeParse`, `z.ZodType<T> satisfies`, `.shape` spread, `z.infer` (×20+) | The terminal vocabulary: `PersistedSnapshotSchema`, `AuthoredActive/Sleeping/ParkedSchema`, `TerminalMetadataSchema`, `SavedTerminalSchema`, **`SavedSessionSchema`**, `DaemonStatusSchema`, `DaemonLifetimeInfoSchema`, `ActivityFeedSchema`, `RecentRepo/RecentAgentSchema` | **DISK + WIRE + user-exportable file.** `SavedSession` is persisted in padi's conf store *and* exported/imported as a user-downloadable JSON blob (`packages/client/src/sessionTransfer.ts`). `activeTerminalId: z.string().nullable().default(null)` exists specifically to keep `.parse()` total over legacy blobs |
| `packages/padi/src/surface.ts` (1402L) | `z.object/array/enum/record/discriminatedUnion/literal/boolean/number/string`, `.merge`, `.extend`, `.default([])`, `.default(true)`, `.nullable`, `.optional`, `.int`, `.min`, `z.infer` | padi's RPC surface: `PadiIdentity/Status/Version`, `RunningKaval/Padi`, `PadiTerminalSchema`, `PadiUrgencySchema`, `PadiCreateInputSchema`, host inventory | **WIRE — critical.** Several `.default([])` are explicitly annotated "for ROLLING-DEPLOY safety: a newer client reading an OLDER server's payload" (`finishedIds`, `workingIds`, `lingerIds`) |
| `packages/padi/src/terminalEndpoint/local.ts` (1690L) | `z.string().uuid()`, `.parse`, `.safeParse`, `ZodType<Saved>` generic, `.shape` (line 444) | Seeds terminals from persisted records; **drops** a malformed record rather than throwing (`persisted-schema-stays-tolerant` policy) | **DISK.** Tolerant-parse semantics must be preserved exactly |
| `packages/padi/src/chromeVocab.ts` | `z.object`, `z.enum`, `z.boolean().default(false)`, `.optional`, `z.string`, `z.number`, `z.infer` | `CanvasLayoutSchema`, `RightPanelPerTerminalStateSchema`, `CodeTabViewSchema` — UI chrome state | **DISK** (persisted UI state) |
| `packages/padi/src/newTerminalPolicy.ts` | `z.discriminatedUnion("kind")`, `z.enum`, `z.literal`, `z.object`, `z.infer` | `NewTerminalPolicySchema` — theme policy for agent-created terminals | Wire |
| `packages/padi/src/session/pairedDaemon.ts` | `z.object`, `z.number`, `z.infer` | `PairedDaemonSchema` | **DISK** (padi conf store) |
| `packages/padi/src/transcript/transcriptSchema.ts` | `z.enum`, `z.object`, `z.string().uuid()`, `z.infer` | `ExportTranscriptHtmlInput/OutputSchema` — RPC contract for HTML transcript export | Wire |
| `packages/kaval/src/ptyHostSurface.ts` (655L) | `z.object/array/boolean/number/string/literal/discriminatedUnion`, **`z.record(z.string(), z.string())`** (env), `.extend`, `.int`, `.min`, `.max`, `.optional`, `z.ZodType satisfies`, `z.infer` (×10) | The pty-host RPC surface: spawn input/output, data msgs, inventory events, `SystemVersionOutputSchema`, `PtyHostIdentitySchema` | **WIRE — critical.** Spans the kolu↔kaval daemon socket across version skew |
| `packages/server/src/state.ts` (684L) | `z.object`, `z.infer`, `.safeParse`, `.min`, plus imported `PreferencesSchema`/`PersistedHostsSchema`/`ViewerModeSchema` | **`PersistedStateSchema`** = the on-disk conf store (`~/.config/kolu`, mode 0600), `SCHEMA_VERSION = "1.36.0"` with a `conf` migration ladder (`migratePreferences_1_30_0/_1_32_0/_1_34_0`, `stripLegacyStateKeys_1_31_0`). Boot-time `safeParse` logs mismatches | **DISK — highest compat risk in the repo.** Byte-format is user data; conf's fail-fast (`clearInvalidConfig: false`) throws on unparseable |
| `packages/server/src/iframePreviewRoute.ts` | `z.infer` of a padi schema, `.min` | Preview-read result typing | Wire |
| `packages/terminal-vocab/src/schema.ts` (537L) | `z.string().uuid()`, `z.discriminatedUnion` (×5), `z.enum`, `z.literal`, `z.object`, `z.array`, `z.boolean`, `z.number`, `.int`, `.nullable`, `.optional`, **`.default(null)` / `.default(0)`**, `z.infer` (×15) | The browser-safe terminal vocabulary: `TerminalIdSchema` (UUID), `AgentInfoSchema`, `AgentMemorySchema`, `PrResultSchema`, `PrUnavailableSourceSchema`, `ForegroundSchema`, `TerminalPortsSchema`, `TerminalSnapshotSchema`, `ProcessRssSchema` | **DISK + WIRE.** `TerminalSnapshot` is persisted; `lastActivityAt: z.number().nullable().default(null)` is a documented backfill that e2e steps rely on |
| `packages/terminal-vocab/src/ports.ts` | `z.enum`, `z.object`, `z.string`, `.int().min().max()` (TCP port range), `.shape` reflection (`PORT_INFO_KEYS`), `z.infer` | `PortInfoSchema`, `TcpPortSchema`, `PortScope/PortFamilySchema` | **WIRE** |

### MCP tool surfaces — `kolu-mcp`

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/kolu-mcp/src/screenText.ts` | `z.object`, `.describe()`, `.int()`, `.max()`, `.optional`, `z.infer` | `ScreenTextArgsSchema` — MCP tool args (`.describe` feeds the JSON-Schema description shown to LLM hosts) | MCP wire |
| `packages/kolu-mcp/src/sendInput.ts` | `z.object`, `.describe`, `.optional`, `z.infer` | `SendInputArgsSchema` | MCP wire |
| `packages/kolu-mcp/src/wait.ts` | `z.object`, `z.enum`, `.describe`, `.int`, `.max`, `.optional`, `z.infer` | `WaitOutputSettledArgsSchema`, `WaitAgentStateArgsSchema` | MCP wire |

### Integrations (all browser-safe, zod-only leaves)

| Path | Zod features | Purpose | Compat risk |
|---|---|---|---|
| `packages/integrations/anyagent/src/schemas.ts` | `z.enum`, `z.object`, `z.discriminatedUnion`, `z.literal`, `z.number`, `z.string`, `z.infer` | `AgentKindSchema`, `TaskProgressSchema`, agent-identity (persisted resume target) | **DISK** (resume identity persisted) + wire |
| `packages/integrations/anyforge/src/schemas.ts` | `z.enum`, `z.object`, `z.array`, `z.number`, `z.string`, `.nullable`, **`.default([])`**, `z.infer` | Forge-neutral PR kernel: `PrInfoSchema`, `CheckRunSchema`, `CheckStatusSchema`, `PrStateSchema` | **WIRE.** `checkRuns: .default([])` is explicitly "so an older server emitting payloads without this field still parses on a newer client" |
| `packages/integrations/github/src/schemas.ts` | `z.enum`, `z.object`, `z.literal`, `z.infer` | `GhUnavailableCodeSchema`, `GhUnavailableSchema` | Wire |
| `packages/integrations/git/src/schemas.ts` (307L) | `z.discriminatedUnion`, `z.enum`, `z.object`, `z.array`, `z.literal`, `z.boolean`, `z.number`, `.uuid()`, `.int`, `.min`, `.nullable`, `.optional`, **`.refine`** (branch-name validity regex, shared client-side), `z.infer` | Worktree create/remove, git status/diff RPC contracts | Wire |
| `packages/integrations/claude-code/src/schemas.ts` | `z.enum`, `z.object`, `z.literal`, `z.number`, `z.string`, `.nullable`, `z.infer` | `ClaudeCodeInfoSchema` | Wire |
| `packages/integrations/codex/src/schemas.ts` | same shape | `CodexInfoSchema` | Wire |
| `packages/integrations/grok/src/schemas.ts` | same shape | `GrokInfoSchema` | Wire |
| `packages/integrations/opencode/src/schemas.ts` | same shape | `OpenCodeInfoSchema` | Wire |
| `packages/integrations/claude-code/src/core.ts` (1575L) | `z.string`, `z.number`, `.default("running")`, `.default(0)`, **`.transform()`** → `ClaudeWorkflow`, `.safeParse`, `.parse`, `.min`, `.max` | `WorkflowJournalSchema` — parses Claude Code's on-disk workflow journal JSON, defaults + reshapes it | **Foreign disk format** (Claude Code's own files — read-only, must keep tolerating them) |
| `packages/transcript-core/src/schemas.ts` (314L) | `z.discriminatedUnion` (×2, deep), `z.enum`, `z.object`, `z.array`, `z.literal`, `z.boolean`, `z.number`, `z.string`, `z.unknown`, `.nullable`, `z.infer` | Vendor-neutral transcript IR: `ToolInputSchema` (7+ arm union: edit/write/patch/read/…), `TranscriptEventSchema`, `TranscriptSchema`, `TranscriptPrSchema` | IR between loaders and renderers; **large union, deepest nesting in the repo** |

### Examples / demos (12 files) — `packages/surface/example/**`, `packages/surface-app/example/**`

`fleet-top/part-{1,2,3}/src/common/surface.ts`, `mini-ci/src/common/{surface,pipeline}.ts`, `remote-process-monitor/src/common/surface.ts`, `snippets/{surface,map,remote}.ts`, `surface/example/src/common/surface.ts`, `surface-app/example/src/common/surface.ts`, `fleet-top/part-3/src/common/map.ts`.
Features: `z.object/array/enum/tuple/boolean/number/string/literal/record/discriminatedUnion`, `.int`, `.min`, `.max`, `.default("TERM")`, `.default([])`, `.nullable`, `.optional`, `.partial`, `.parse`, `z.infer`. **No compat risk** (demo apps), but they are the framework's *documented* API surface — they double as the README/tutorial code and must be migrated in lockstep or the docs go stale.

### Tests (53 files)

Concentrated in `packages/surface/src/**` (~30), `packages/surface-map/src/**` (8), `packages/surface-remote/src/**` (10), `packages/surface-mcp/src/**` (4). Almost all use only `z.object`/`z.string`/`z.number`/`z.boolean`/`z.array`/`z.void` to build throwaway test surfaces — mechanical conversions. Three are load-bearing:

- `packages/surface/src/solid/boundProcedure.test-d.ts` — **type-level** proof that `.default()` and `.transform()` produce divergent `z.input`/`z.output` and that `BoundProcedure` splits the two directions. This test *is* the specification for the trickiest inference behaviour.
- `packages/surface-map/src/foldEnvelope.test.ts` — pins the "void member carries no `input` key" wire rule.
- `packages/surface-mcp/src/jsonschema.test.ts` — snapshot test of the zod→JSON-Schema output, including `z.date()` degradation and `.default()`/`.optional()` handling.
- `packages/surface-map/src/mapHarness.testlib.ts` and `packages/surface-remote/src/serveHostMap.test.ts` both use `z.string().brand("HostKey")`.

---

## Trickiest conversions, ranked

1. **`z.toJSONSchema` in `surface-mcp/src/jsonschema.ts`.** The entire MCP tool-listing path depends on zod 4's native converter with five pinned options, plus a hand-written `$ref` dereferencer. Effect Schema's `JSONSchema.make` differs in `$defs` emission, recursion handling, and has no `io: "input"` switch — the "a `.default()` arg must not be `required`" rule has to be re-derived. Snapshot-tested, so breakage is visible but the fix is non-mechanical.

2. **`z.input` vs `z.output` divergence (`surfaceClient.ts` + `boundProcedure.test-d.ts`).** Effect's `Schema.Schema<A, I, R>` gives `Schema.Encoded` / `Schema.Type`, but adds a **third context type parameter `R`** that has no zod counterpart. Every `ZodType<T>` bound in `surface/src/define.ts` (a ~40-site generic constraint) becomes a two- or three-parameter type, and the conditional-inference machinery (`S extends { patchSchema: ZodType<infer P> }`, `SurfaceTypes<S>`) has to be rewritten. This is the largest type-level blast radius.

3. **`.def.type` runtime introspection (`surface-map/src/define.ts:268`).** Detects `z.void()`/`z.undefined()` members to decide whether the fold envelope emits an `input` key. Effect Schema exposes `AST._tag` instead (`VoidKeyword`/`UndefinedKeyword`), so the probe is rewritable — but the surrounding rule (documented as a zod-version regression that dark-screened drishti's fleet view) must be re-proved on Effect's semantics.

4. **`.shape` reflection (5 sites).** `common/surface.ts:689` (`FORWARD_KEYS`), `terminal-vocab/ports.ts:217` (`PORT_INFO_KEYS`), `surfacesWithPadi.ts:148`, `padi/vocab.ts:654`, `padi/terminalEndpoint/local.ts:444`. Effect's `Schema.Struct` exposes `.fields`, so these work — but the *spread* uses (`...SkewVersionPairSchema.shape`) need `Schema.Struct({ ...A.fields, ...B.fields })`.

5. **Object composition: 29 `.merge`/`.extend`/`.pick`/`.omit`/`.partial` sites**, 14 of them in `padi/src/vocab.ts` alone (a deep `.merge` chain building the authored-terminal union) and 8 in `padi/src/surface.ts`. Effect has `Schema.extend` / `Schema.pick` / `Schema.omit` / `Schema.partial` but no direct `.merge`, and `.extend` semantics on unions differ.

6. **Brands (3 sites).** `MembershipIdSchema = z.string().min(1).brand("MembershipId")` (production), plus two test-side `z.string().brand("HostKey")`. Effect's `Schema.brand` is close but the erasure/assignability rules differ; `MembershipId`'s whole point is that a bare `string` must be a **compile error**.

7. **Refinements (5 sites).** `PersistedHostsSchema`'s three chained array-level refinements (canonical encoding / no-local / no-duplicates), `DaemonInventorySchema`'s cross-field "at least one non-null", and `WorktreeNameSchema`'s branch-name regex (shared with the client as a live predicate). Effect's `Schema.filter` is the equivalent, but the *error messages* are user-visible in toasts and boot logs.

8. **Transforms (1 production site).** `claude-code/src/core.ts:719` — `WorkflowJournalSchema` reshapes `{workflowName,status,agentCount}` → `ClaudeWorkflow` with two `.default()`s. Straightforward `Schema.transform`.

9. **Wire-compat defaults.** Six `.default([])` / `.default(null)` / `.default(true)` sites are explicitly commented as **rolling-deploy tolerance** (`padi/surface.ts` `finishedIds`/`workingIds`/`lingerIds`, `anyforge` `checkRuns`, `padi/vocab.ts` `activeTerminalId`, `terminal-vocab/schema.ts` `lastActivityAt`). Effect's `Schema.optionalWith(..., { default: () => [] })` must reproduce *both* directions (accept-missing on decode, and the encoded shape must still omit-or-emit identically).

10. **`z.prettifyError`** (`surface-remote/src/agentBinaryCache.ts:84`) — one call, needs `TreeFormatter.formatErrorSync` or equivalent.

11. **`z.never().optional()` as an anti-field** (11 sites in `padi/src/vocab.ts`, lines 640–676) — used to make a payload field *unspellable* on the shared arm of `DaemonStatusSchema`. Effect equivalent (`Schema.optional(Schema.Never)`) exists but should be verified to actually reject a present value.

**No recursive schemas** (`z.lazy` appears nowhere), **no `z.codec`** (explicitly considered and rejected in `surface-map/src/define.ts:445-461`, with the reasoning recorded), and **no zod `.catch()`** anywhere (every `.catch(` hit is `Promise.prototype.catch`).

---

## Byte-compatibility hit list (must not change)

| Format | Schema(s) | Where |
|---|---|---|
| `~/.config/kolu` conf store (mode 0600), `SCHEMA_VERSION 1.36.0` + 4-step migration ladder | `PersistedStateSchema` = `{preferences, hosts, viewerMode}` | `packages/server/src/state.ts` |
| Encoded host-key strings inside that store | `PersistedHostsSchema` + `encodeHostKey`/`decodeHostKey` | `packages/common/src/hostKey.ts` |
| padi conf store (`PADI_STATE_SCHEMA_VERSION`, empty migration ladder) | `SavedSessionSchema`, `SavedTerminalSchema`, `PersistedSnapshotSchema`, `PairedDaemonSchema`, `ActivityFeedSchema` | `packages/padi/src/vocab.ts`, `session/stateStore.ts` |
| User-exportable session JSON (download/import hatch) | `SavedSessionSchema` + `backfillSavedSession` | `packages/client/src/sessionTransfer.ts` |
| Terminal snapshot records seeded on cold boot (tolerant drop-on-malformed) | `PersistedSnapshotSchema`, `AuthoredActive/Sleeping/ParkedSchema`, `TerminalIdSchema` (UUID) | `packages/padi/src/terminalEndpoint/local.ts` |
| kolu ↔ kaval pty-host socket (version-skew tolerant) | `ptyHostSurface.ts` schemas incl. `z.record` env | `packages/kaval/src/ptyHostSurface.ts` |
| Remote surface mirror over ssh (cross-build, cross-repo with drishti) | `collectionDeltasSchema`, `ServedIdentitySchema`, `ServedClockNowSchema`, `ConnectionInfoSchema`, map fold envelope `{mapKey, input}` | `surface/src/define.ts`, `surface/src/identity.ts`, `surface-remote/src/connection.ts`, `surface-map/src/define.ts` |
| MCP `tools/list` JSON Schema (consumed by Anthropic/Gemini/Bedrock/Codex/Claude Desktop) | `toInputSchema` output | `packages/surface-mcp/src/jsonschema.ts` |
| Claude Code's own workflow-journal files (foreign, read-only) | `WorkflowJournalSchema` | `packages/integrations/claude-code/src/core.ts` |
