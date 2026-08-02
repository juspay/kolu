# W3 — `kolu-common` on the Effect surface contract + Effect Schema

Scope: `packages/common/src/{contract,surface,hostKey,surfacesWithPadi}.ts` and every
test in the package. Zero `zod` / `@orpc/*` imports remain in `src/`.

Built against the committed W2 core: S1 (`Surface {group, tagPrefix, spec}`, the tag
algebra, `WireSchema`/`WireSchemaAny`, `composeSurfaceContracts → {group, siblings}`),
S3 (the spec-typed client face), and the surface-map report (`defineSurfaceMap`'s
`WireSchemaAny` key bound, `{group, tagPrefix}`).

---

## 1. The shapes that changed

### 1.1 `contract.ts` — `oc.router` → one flat `RpcGroup`

`export const contract` is now an **`RpcGroup`**, not a nested oRPC router object.
The nesting collapses into slash-joined tags (D1), so `server: { info }` is the tag
`"server/info"`, and the surface siblings' tags are `surface/<sibling>/<member>/<verb>`.

| before (oRPC path) | after (wire tag) |
|---|---|
| `server.info` | `server/info` |
| `daemon.restart` | `daemon/restart` |
| `hosts.viewer` | `hosts/viewer` |
| `hosts.add` / `.remove` / `.reconnect` / `.renewDaemon` | `hosts/add` / `hosts/remove` / `hosts/reconnect` / `hosts/renewDaemon` |
| `...composeSurfaceContracts(surfaces)` (spread) | `koluSurfaceGroup` = `composeSurfaceContracts(surfaces).group` |

New exports:

- **`koluRootGroup`** — the seven root procedures ALONE. It is its own value because
  kolu-server serves a SUPERSET: it re-composes the surfaces WITH padi and merges the
  host map's group. Merging two differently-composed surface groups would collide every
  `surface/*` tag last-writer-wins, so the server needs the root half separately.
- **`koluSurfaceGroup`** — the padi-less composed surface group.
- **`ROOT_RPC_TAGS`** — the seven root tags spelled literally; the import-time assertion
  and `contract.test.ts` both read it.
- **`HostRefSchema`** (`{host: HostKey}` — the payload of the four membership verbs) and
  **`ViewerHostSchema`** (`{host: HostKey | null}`).

`hosts/viewer` stays a ROOT procedure, unchanged in intent: the answer is per-CALLER, and
a broadcast surface cell cannot carry a different answer per viewer. Under Effect RPC the
caller's address reaches the handler as a `CurrentViewer` service provided by an
`RpcMiddleware` — **W4 installs it**; the contract only declares the procedure. That is
stated in the docstring so a future reader does not look for a transport here.

**#16 is enforced at import, twice**: `assertTagCount(koluRootGroup, 7)` plus a
per-tag `requests.has()` loop, and `assertTagCount(contract, |surface| + |root|)` after
the merge. `RpcGroup.make`/`.merge` are last-writer-wins `Map.set`s, so a collision is
otherwise silent. `merge` is safe HERE (unlike between two surfaces, which share the
three reserved `system/*` tags — D1) because the halves live in disjoint tag roots; the
assertion is what PROVES that rather than assuming it.

`ServerInfoSchema` / `PwaIdentitySchema` are Effect Structs; the types are
`typeof …Schema.Type`.

### 1.2 `surface.ts` — every schema on Effect Schema

`koluSurface` is unchanged in structure (`defineSurfaceWithPolicy<ToastOnlyPolicy>()`,
seven cells, the `forwards` procedures); only the schemas moved. The translations that
were not one-for-one:

| site | before | after |
|---|---|---|
| `z.enum([...])` ×7 | `ColorScheme`, `ViewerMode`, `NewTerminalTheme`, `ShuffleBehavior`, `terminalRenderer`, `PadiLink`, `ForwardOrigin` | `Schema.Literals([...])` (array arg) |
| `z.discriminatedUnion("kind"\|"cause", …)` ×6 | `DaemonBuild`, `InstanceKey`, `PadiConvergence` (+ its inner `cause`), `DaemonBinding`, `HostKey`, `PadiEntryFailure` | `Schema.Union([Schema.Struct…])` — **not** `Schema.TaggedUnion`: the discriminant is `kind`/`cause`, not `_tag`, and these bytes are frozen |
| `z.number().int()` | `attempts`, `maxAttempts` | `Schema.Number.check(Schema.isInt())` |
| `.nullable()` | 9 sites | `Schema.NullOr(…)` |
| `z.infer<typeof S>` | 20 sites | `typeof S.Type` |
| `KoluForwardSchema.shape` (FORWARD_KEYS reflection) | `.shape` | **`.fields`** — same read-off-the-schema promise, same dedup gate |
| `koluBuildInfo`'s `version: z.string().optional()` | `.optional()` | **`Schema.optionalKey`** (#17 law) |

**`PreferencesPatchSchema`** — the `.omit().partial().extend()` chain, per the
`recon/effect4.md` §5 cheat-sheet:

```ts
PreferencesSchema.mapFields(Struct.omit(["rightPanel"]))
  .mapFields(Struct.map(Schema.optionalKey))
  .mapFields(Struct.assign({
    rightPanel: Schema.optionalKey(
      RightPanelPrefsSchema.mapFields(Struct.map(Schema.optionalKey)),
    ),
  }))
```

`optionalKey`, never `optional`, at BOTH levels (#17): a patch field is ABSENT when
unset, and `Schema.optional` would round-trip an explicit `undefined` through `null`,
which `applyPreferencesPatch` would then merge in as a real value.

**`DaemonInventorySchema`'s cross-field refine** is a `Schema.makeFilter` check on the
inner struct, returning the SAME user-visible message zod's `.refine` carried
(`"boundPadi: nothing to report is the top-level null, not an inner object with every
field null"`). The message is now pinned by a test, not just the accept/reject verdict.

### 1.3 `hostKey.ts` — the DISK-critical module

- `HostKeySchema` is a two-arm `Schema.Union` (`kind` discriminant, `target` checked
  `isMinLength(1)`); `HostKey` is `typeof …Type`.
- **New export `decodeHostKeyValue`** — the ONE re-validation entry (surface-map's
  `decodeMembershipId` precedent). `Schema.decodeUnknownSync`, so it THROWS exactly as
  `HostKeySchema.parse` did: a value that is not a `HostKey` is a caller bug, never a
  branchable condition.
- `encodeHostKey` / `decodeHostKey` / `isEncodedHostKey` / `parseHostInput` /
  `hostKeysEqual` / `hostKeysInclude` are **untouched** — they are plain string
  functions and were never zod's.
- `PersistedHostsSchema` keeps all THREE refinements with their exact messages:
  element-level `"not a canonical encoded host key"` (a `makeFilter` on the element
  schema), then two array-level checks — `` `the local default ("local") must never be
  persisted` `` and `"duplicate host entries"`. New type export `PersistedHosts`.

### 1.4 `surfacesWithPadi.ts`

`padiHostMap` moves onto the new `defineSurfaceMap` unchanged in arguments — the key
bound is now `WireSchemaAny`, which `HostKeySchema` satisfies. `SkewVersionPairSchema`'s
`.shape` spread into the skew arm becomes a `.fields` spread; `PadiEntryFailureSchema` is
a `Schema.Union` of eleven structs (no catch-all arm, as before).

---

## 2. Public API breaks (additions to the drishti/odu + in-repo follow-up list)

1. **`contract` is an `RpcGroup`**, not an oRPC router object. `implement(contract)`,
   `t.server.info`, `ContractRouterClient<typeof contract>` all break (server `surface.ts`
   / `router.ts`, client `wire.ts` — W4/W5).
2. **Wire paths are tags**: `server.info` → `"server/info"`, `surface.kolu.preferences.get`
   → `"surface/kolu/preferences/get"`.
3. **New exports** from `kolu-common/contract`: `koluRootGroup`, `koluSurfaceGroup`,
   `ROOT_RPC_TAGS`, `HostRefSchema`, `HostRef`, `ViewerHostSchema`, `ViewerHost`.
4. **Every exported schema is an Effect `Schema`**: `.parse` / `.safeParse` / `.shape` /
   `z.infer` are gone everywhere. Replacements: `Schema.decodeUnknownSync` (throws),
   `Schema.decodeUnknownResult` (a `Result`), `.fields`, `typeof S.Type`.
5. **New export `decodeHostKeyValue`** (`kolu-common/hostKey`) — use it instead of
   `HostKeySchema.parse`.
6. **New export `PersistedHosts`** (the decoded `readonly string[]`).
7. `PreferencesPatch`'s optional fields are `optionalKey`-shaped: an explicit
   `{ scrollLock: undefined }` no longer DECODES (an absent key is the only spelling).
   Any in-process caller that builds a patch with `undefined` values must strip them.
8. Decoded values are `readonly` (Effect's `Struct.Type`), including
   `Forwards`/`PersistedHosts` arrays. Consumers that mutate a decoded array in place
   break; nothing in this package did.

---

## 3. Byte-fixture inventory

Two hit-list formats live in this package. Both are pinned on the encoded JSON
**string**, not on decode-equality.

`src/hostKey.test.ts` (24 tests, GREEN today — this module has no padi edge):

- the encoded HostKey object bytes for both arms;
- the persisted STRING form for five spellings, both directions
  (`local`, `remote:zest`, `remote:srid@zest`, `remote:remote:zest`, `remote:127.0.0.1`);
- `PersistedHostsSchema`: a stored list round-trips byte-identically; the empty list
  encodes `[]`; and one negative test per refinement, each asserting the exact
  user-visible MESSAGE (non-canonical element / persisted `local` / duplicates).

`src/surfaceByteCompat.test.ts` (NEW, 15 tests):

- **`preferences`** (on-disk): `DEFAULT_PREFERENCES`'s exact bytes, a populated record
  round-tripping byte-for-byte, an unknown key DROPPED (the migration ladder's
  tolerance — zod's `strip` default, preserved), a missing field REJECTED;
- **`viewerMode`** (on-disk): `"dark"` / `"light"` as bare JSON strings, `"system"`
  rejected (that is a preference, not a viewer reading);
- **`PreferencesPatch`**: an unset field stays ABSENT (the `optionalKey`-vs-`optional`
  divergence #17 names), a deep-partial `rightPanel`, the empty patch, and the explicit
  `undefined` rejection;
- **`KoluForward`** (wire): both host arms, key order pinned;
- **`DaemonInventory`** (wire): the pre-sample default, and inner `null`s staying PRESENT;
- **`PadiEntryFailure`** (wire): the skew arm with the spread `SkewVersionPair` fields in
  declaration order, a plain arm, and an unclassified cause rejected.

`src/contract.test.ts` (NEW, 9 tests) is the D1/#16 replacement for the deleted oRPC
router-path tests: the literal root tag set, root tags staying out of `surface/`,
`hosts/viewer` being a root procedure, every sibling carrying its OWN three `system/*`
tags, kolu's cell/procedure tags spelled literally, no write verb on a read-only cell,
the merge dropping nothing, and no `surface/padi/*` tag on the padi-less contract.

`src/surface.test.ts` is ported (`.safeParse(x).success` → a local `accepts` helper over
`Schema.decodeUnknownResult`; `.shape` → `.fields`) and gained the refine-MESSAGE pin.

---

## 4. Gates — and the one thing blocking two of them

```
biome check --error-on-warnings packages/common   → clean (exit 0)
biome format .                                     → clean repo-wide (so `just fmt` is a no-op)
grep -i 'zod|@orpc' packages/common/src            → only historical prose in comments
```

**`pnpm --filter kolu-common typecheck` and `test:unit` are RED, and every failure is
`packages/padi`, which this agent may not touch.**

- `packages/padi` is mid-migration: its `vocab.ts`/`surface.ts` are still zod, and
  `vocab.ts:156` calls `.pick` on `TerminalSnapshotSchema`, which `@kolu/terminal-vocab`
  already converted to Effect Schema. So **importing `@kolu/padi/surface` THROWS at
  module load** (`TerminalSnapshotSchema.pick is not a function`). `surface.ts` value-imports
  `HostDaemonInventorySchema` from it, so the three test files that reach
  `kolu-common/surface` fail at IMPORT, before any assertion runs.
- Real test run: **4 files / 47 tests pass** (`hostKey` 24 + `hostHue` + `nixFileset` +
  `preview`); `surface.test.ts`, `surfaceByteCompat.test.ts`, `contract.test.ts` fail to
  import. That was ALSO the state before this commit (`surface.test.ts` was already red
  at HEAD for the same reason) — this commit adds no new red.
- Real typecheck: **9 errors, all downstream of ONE line** — `surface.ts:576`
  `localScan: HostDaemonInventorySchema` (a zod value where a `WireSchema` is required).
  Its unresolved arm poisons `DaemonInventorySchema` → `koluSurface.spec` →
  `SurfaceTypes<…>` → `Preferences`/`PreferencesPatch`, and the three test files that
  pass `DaemonInventorySchema` to a `Schema.Codec` parameter.

**Verified, not assumed**: with `@kolu/padi/surface` aliased to a throwaway stub that
declares the same members on the NEW APIs (an Effect `HostDaemonInventorySchema` + a
one-cell `defineSurface` padi surface), the package is **`tsc --noEmit` ZERO errors and
7 files / 96 tests ALL GREEN**. The stub lived only in the scratchpad and is not in the
tree. So both gates close the moment padi lands, with no further change here.

---

## 5. Deviations / deliberate non-changes

1. **`Schema.Union`, never `Schema.TaggedUnion`, for the six `kind`/`cause` unions.**
   `TaggedUnion` fixes the discriminant at `_tag`; these discriminants are `kind` and
   `cause`, and their bytes are on disk and on the wire. Same call surface-map made.
2. **The three `PersistedHosts` refinements stay THREE separate filters** rather than one
   fused check, because each carries its own user-visible message and each has its own
   negative test. Effect collects all failing checks, where zod's chain short-circuited
   per-refinement — the messages, which are what a user reads, are unchanged either way.
3. **A key the SCHEMA rejects still THROWS** (`decodeHostKeyValue`,
   `Schema.decodeUnknownSync`) rather than becoming a typed failure — the zod `.parse`
   semantic, preserved deliberately: a non-`HostKey` at the wire is a caller bug.
4. **`DEFAULT_PREFERENCES` and every cell `default` keep their `satisfies` annotations**,
   now against `typeof S.Type`. This is what caught a drifted default in the past and it
   still does.
5. **`Struct.map(Schema.optionalKey)` over `Schema.partial`-style helpers**: it is the
   cheat-sheet's own translation and it makes the #17 choice (`optionalKey`) explicit at
   the call site instead of hiding it behind a helper's default.
6. **No `package.json` change** — `effect` was already declared; `zod` + `@orpc/contract`
   are now UNUSED but still declared (W6 owns the purge, and removing them here would fire
   PLAN standing rule 5 for no benefit). **Standing rule 5 does not fire for this package.**
7. **`just fmt` was satisfied by `biome format --write packages/common`** plus a repo-wide
   `biome format .` check (clean). The repo-wide WRITE was avoided on purpose: a sibling
   agent is editing `packages/kaval` in this worktree right now.

---

## 6. Hand-offs

### To the padi agent (W3)

- `HostDaemonInventorySchema` must become an Effect `WireSchema` — `kolu-common`'s
  `DaemonBindingSchema` embeds it, and until then this package cannot typecheck.
- `vocab.ts:156` `TerminalSnapshotSchema.pick({...})` →
  `TerminalSnapshotSchema.mapFields(Struct.pick([...]))`; the same file's `.merge` /
  `.optional` / `.safeParse` sites are the other import-time crashers.
- `padiSurface`'s spec schemas must all be `WireSchema`s before `padiHostMap`
  (`entry: padiSurface`) types precisely.
- `NewTerminalPolicySchema` / `DEFAULT_NEW_TERMINAL_POLICY` / `newTerminalPolicyEqual`
  are re-exported through `kolu-common/surface`; keep the names.

### To the server agent (W4)

- Build the served superset as **groups, not a spread**:
  `koluRootGroup.merge(composeSurfaceContracts(surfacesWithPadi).group, padiHostMap.group)`
  — do NOT merge `contract` itself with a padi-ful composition (it already carries the
  padi-less `surface/kolu/*` + `surface/surfaceApp/*` tags; a second composition would
  collide every one of them silently). Assert the resulting `requests.size`.
- `hosts/viewer` needs the `CurrentViewer` `RpcMiddleware` (D5/#6): inject
  `HttpServerRequest.remoteAddress` as a synthetic header before `onSocket`.
- `state.ts`: `PersistedStateSchema` becomes a `Schema.Struct` over the (now Effect)
  `PreferencesSchema` / `PersistedHostsSchema` / `ViewerModeSchema`. The encoded shapes
  are byte-identical — `surfaceByteCompat.test.ts` + `hostKey.test.ts` are the fixtures.
  The migration ladder's in-process `.parse` callers become
  `Schema.decodeUnknownSync`, and per #17 must STRIP `undefined` keys first.
- `hostPersistence.ts`'s `PersistedHostsSchema.safeParse(store.get("hosts"))` →
  `Schema.decodeUnknownResult(PersistedHostsSchema)(…)`; keep the "throw where it is
  read, never normalize" behaviour — the three messages are pinned.
- `index.ts:937` `HostKeySchema.parse(decodeHostKey(raw))` → `decodeHostKeyValue(...)`.

### To the client agent (W5)

- `import type { contract }` in `wire.ts` is now an `RpcGroup`; the typed face comes from
  the spec (D2), not from the contract type.
- `HostSelectorStrip.test.ts`'s six `HostKeySchema.parse(...)` calls →
  `decodeHostKeyValue(...)`.
- A patch object built with explicit `undefined` values is no longer decodable — strip
  the keys (see break 7).
- Decoded surface values are `readonly`; `Forwards` is a `readonly` array.
