# W3 — `kaval` on the Effect surface + Schema (contract v7.0)

Scope delivered: `ptyHostSurface.ts` (every zod schema → Effect Schema, the D6
epoch bump, the D4 declared errors), a NEW `ptyHostClient.ts`, `inProcessPtyHost.ts`,
`daemonSurface.ts`, `serveOverSocket.ts`, `daemonMain.ts`, `initFiles.ts`,
`index.ts`, the README, and every test — plus a NEW `contractSkew.test.ts` (the
in-epoch skew harness expressed in the new wire). Nothing outside
`packages/kaval` was touched; `package.json` is unchanged, so PLAN standing rule 5
does not fire.

---

## 1. `PTY_HOST_CONTRACT_VERSION`: "6.0" → **"7.0"** (PLAN D6)

The bump is the **protocol-epoch flag day**, and the note in `ptyHostSurface.ts`
says exactly that. No payload shape moved — every member encodes byte-for-byte as
it did under zod, which `ptyHostSurface.test.ts` and `systemVersionShape.test.ts`
now assert as **literal JSON strings** rather than assume. What moved is the
framing beneath them: oRPC base64+newline peer protocol → Effect RPC ndjson.

Why bump at all, when the lever is inert across the only boundary that changed?
Because the constant is the **in-epoch skew mechanism** (D6's final bullet) and
must keep working from the flag day forward. Leaving it at "6.0" would let two
mutually undecodable epochs report the SAME string, so a `6.0`-reporting peer
would compare EQUAL to ours and be adopted as wire-compatible — the pty-host's own
version lever silently disarmed across the one break it most needed to name. That
hazard is now a test (`contractSkew.test.ts`, third case), not a comment.

Cross-epoch peers stay the supervisor's `unspeakable-protocol` domain (D6/#3);
this package never claims to classify them.

## 2. Shapes — what a consumer now holds

### 2.1 `PtyHostClient` — new home, new type, same address

```ts
// packages/kaval/src/ptyHostClient.ts   (NEW — subpath-free, imported by name)
type PtyHostClient = SurfaceClientOf<typeof ptyHostSurface.spec>;   // @kolu/surface/project
function ptyHostClientOver(dispatch: SurfaceDispatch): PtyHostClient;
```

`ContractRouterClient<typeof ptyHostSurface.contract>` is gone with the contract.
The successor is the framework's OWN spec-derived member face (S3's
`buildSurfaceFace`, typed by `project.ts`'s `SurfaceReadFace`) — not a hand-written
mirror, so a schema edit is a compile error at every call site.
`ptyHostSurface` declares no cells and no collections, so the "read face" IS the
whole face here.

`client.surface.<member>.<verb>` still addresses everything. Two shape changes:

| | before (oRPC) | now |
|---|---|---|
| procedure | `(input) => Promise<Out>` | `(inputEncoded) => Promise<Out>` — input is the **Encoded** side (D2/#13); the face decodes at the edge, where zod's `.parse` used to run |
| stream member | `await c.surface.X.get(input, {signal}) → AsyncIterable<T>` | `c.surface.X.get(inputEncoded) → Stream<T>`, **synchronously, lazily** |

Cancellation is fiber interruption (D10/#18) — no `AbortSignal` anywhere. A
pull-shaped consumer runs a member with `Stream.toAsyncIterable` and unsubscribes
with `iterator.return()`.

`ptyHostClientOver` exists so **one** cast (`SurfaceFace` → `SurfaceClientOf`)
lives in the tree instead of one per consumer. It is the wire twin of
`surfaceClientRef`, which the in-process leg uses directly.

### 2.2 `servePtyHost` / `createInProcessPtyHost`

```ts
interface PtyHostServed {                       // NEW, exported
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly handlers: SurfaceHandlers;
}

createInProcessPtyHost(deps): {
  readonly served: PtyHostServed;   // was: router + servedRouter (both Router<any,any>)
  client: PtyHostClient;            // was directLink; now surfaceClientRef → directDispatch
  readonly boot: PtyHostBoot;       // unchanged
  terminalCount(): number;          // unchanged
  done: Promise<void>;              // unchanged
  close(): Promise<void>;           // unchanged
}
```

`PtyHostRouter` and the `servedRouter` field are **deleted**, and with them BOTH
`biome-ignore lint/suspicious/noExplicitAny` comments that existed only to carry
`Router<any, any>`. `Rpc.Any` is the honest erasure (review #16), and route-set
identity between group and handlers is asserted by `implementSurface` at boot
rather than claimed by a type.

### 2.3 `serveKavalDaemonSurface` — the needs-design spot

```ts
const kavalControlSurface: Surface<typeof controlCoreSurface.spec>;  // NEW export
const kavalDaemonGroup: RpcGroup.RpcGroup<Rpc.Any>;                  // NEW export

interface KavalDaemonSurface {          // was { router: KavalDaemonRouter, done, close }
  readonly group; readonly handlers; readonly done; close();
}
```

`kavalDaemonContract` and `KavalDaemonRouter` are **deleted**.

The oRPC version hand-spliced two finalized contracts and then re-adapted two
finalized ROUTERS against the widened contract's matcher, behind two `as any`
casts — because a router carried no route of its own. On the Effect wire a tag
carries its own route, so composition is a **disjoint union of two flat tag maps**
and there is nothing to re-adapt:

- the pty half is `ptyHostSurface.group`, prefix `surface/` — untouched, byte-for-byte
  its standalone tags;
- the control half is `composeSurfaceContracts({ control: controlCoreSurface })
  .siblings.control`, prefix `surface/control/` — the **same expression**
  `probeDaemonIdentity` already builds its dialing group from, so kaval's serving
  and the supervisor's dialing cannot be derived by two different rules.

Both merges are **checked, not assumed** (D1/#16): `mergeGroupsDisjoint` asserts
`merged.requests.size === a.size + b.size` and names the colliding tags on failure;
`mergeHandlersDisjoint` throws on a double-bound tag. The three reserved `system/*`
tags — the ONE overlap a bare `RpcGroup.merge` would have silently collided — are
disjoint here by the sibling prefix (`surface/system/*` vs
`surface/control/system/*`), and `daemonSurface.test.ts` proves it by spelling the
**entire 28-tag key set literally** and comparing it to both `kavalDaemonGroup.requests`
and the bound handler record.

### 2.4 `servePtyHostOverUnixSocket`

```ts
servePtyHostOverUnixSocket({ socketPath, served: PtyHostServed, log? })
```

`router` → `served`. The outcome→log-message mapping (`dir-not-private` /
`already-served` / `probe-failed` / `not-a-socket` / `bind-failed` / `listening`)
is **verbatim**. `serveOverUnixSocket` lost its `log` option (S4 deleted
`UnixSocketLogger`), so the transport's runtime chatter is gone; only the
bind-time verdicts reach this module, which is all it ever narrated. A comment at
the call site records what disappeared so nobody re-adds a knob for it.

`daemonMain.ts` forwards `group`/`handlers` to the spine's `DaemonSpec` — two flat
fields, spelled the same on both sides.

## 3. The declared-error vocabulary (PLAN D4)

Two `Schema.TaggedErrorClass`es, exported from `ptyHostSurface.ts` and re-exported
from `index.ts` as VALUES:

| class | `_tag` | id | fields | declared on |
|---|---|---|---|---|
| `PtyNotFound` | `"PtyNotFound"` | `kaval/PtyNotFound` | `id: string` | `terminal.{getScreenState,getScreenText,getHistory}` |
| `SpawnArgvEmpty` | `"SpawnArgvEmpty"` | `kaval/SpawnArgvEmpty` | — | `terminal.spawn` |

They replace `ORPCError("NOT_FOUND")` and `ORPCError("BAD_REQUEST")`; the
discriminant is the `_tag`, not a magic code compared by hand. Round-trip
(`encode → JSON → decode`) with tag, data and message intact is **pinned**, and a
NEGATIVE test enumerates exactly which members declare an error — so a member
cannot quietly acquire an error channel.

**The stream asymmetry, stated rather than hidden.** `requirePty` also guards five
per-terminal STREAMS, but a `StreamSpec` has no error channel to declare on. There
the same `PtyNotFound` instance is raised as an UNDECLARED failure ⇒ a defect: it
narrows in-process (the identity link runs the very handler stream, pinned in
`inProcessPtyHost.test.ts`) and crosses a wire opaquely (the corpus asserts only
"it rejects", as it already did for its own reasons). Two spellings of one rule,
`requirePtySync` / `requirePtyEffect`, so neither channel is faked in the other's
terms.

Everything else stays a defect by design and is documented at each site: a
duplicate live spawn id, a node-pty failure, the `terminate` deadline blowing, a
rejecting control-core `onDrain`.

**Drain.** `ORPCError("PRECONDITION_FAILED")` becomes a plain throw. The frozen
`core.drain` declares no error schema — not kaval's to widen — and
`controlCoreFragment` runs the hook under `Effect.promise` precisely so an
undeclared throw stays a defect. What a caller relies on is unchanged and still
pinned twice (in-process and over a real spawned daemon's socket): it REJECTS with
its reason, and the daemon is demonstrably still answering afterwards.

## 4. Schema mapping applied (PLAN #17 is LAW)

| zod | Effect Schema |
|---|---|
| `z.string()` / `z.boolean()` / `z.number()` | `Schema.String` / `Schema.Boolean` / `Schema.Number` |
| `z.number().int()` | `Schema.Int` |
| `z.number().int().positive()` | `PositiveInt` = `Schema.Int.check(Schema.isGreaterThan(0))` |
| `z.number().int().nonnegative()` | `NonNegativeInt` = `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` |
| `z.array(X).min(1)` | `Schema.Array(X).check(Schema.isMinLength(1))` |
| **`z.record(z.string(), z.string())`** (spawn `env`) | **`Schema.Record(Schema.String, Schema.String)`** |
| `X.optional()` | **`Schema.optionalKey(X)`** — never `Schema.optional` |
| `z.discriminatedUnion("kind", […])` | `Schema.Union([Schema.Struct…])` — discriminant stays **`kind`**, never `_tag` |
| `PtyGridSchema.extend({id})` | `Schema.Struct({ ...PtyGridSchema.fields, id })` (same key order) |
| `z.infer<S>` | `typeof S.Type` (and `typeof S.Encoded` for `PtyHostSpawnInput`) |
| `satisfies z.ZodType<T>` | `satisfies WireSchema<T>` |

`PositiveInt` / `NonNegativeInt` are named once so every grid dimension, cursor and
bound is the same check rather than N re-derivations.

**`PtyHostSpawnInput` is now the ENCODED side** (`typeof …Schema.Encoded`) — what
`z.input<>` meant here, and the side every composer actually holds (kaval-tui's
`create`, the corpus, kolu-server's `kolu-pty`). `writeInitFiles` takes a
`readonly` array, since that is what a decoded `Schema.Array` hands the handler.

### Byte fixtures (the #17 obligation)

`ptyHostSurface.test.ts` (new) and `systemVersionShape.test.ts` pin **literal JSON
strings** for: the full and minimal spawn input (including an arbitrary env key,
which is what proves `Schema.Record` and not a struct), all three attach-frame
arms, both inventory delta arms, a sparse and a full list entry, both `getHistory`
arms, all four `getScreenText` extents, the identity pair, and the whole
`system.version` handshake with and without its two optional keys. Absence encodes
**absent**, never `null` — asserted directly, because that is the one thing
`Schema.optional` would have silently broken.

## 5. Tests

All ported; two files added.

- **`contractSkew.test.ts` (NEW)** — the in-epoch skew harness in the new wire. A
  fake daemon serves the REAL `surface/system/version` `Rpc` (taken live out of
  `ptyHostSurface.group`, so a fake can never drift from what it imitates) over a
  REAL unix socket on the current ndjson protocol, answering with a version string
  of the test's choosing. Four cases: the handshake reads fine off a peer whose
  version is not ours (**the skew verdict is DATA, not a transport failure** — the
  distinction D6 rests on); an older minor is refused; a previous-epoch string is
  refused (§1's guard); and a member the peer never served fails as a MISSING
  ROUTE, distinguishable from a protocol break. This is the model padi's
  `ptyHost/connect.test.ts` should be rewritten against — see §7.
- **`daemonSurface.test.ts`** — gained the #16 route-set block: the literal 28-tag
  key set, the disjointness of the two halves stated on both axes, and
  handler-set == group-set.
- **`streamFrame.testlib.ts`** — now owns the ONE `Stream` → pull-shaped-iterator
  bridge (`openStream` / `closeStream`) plus `subscribeFrames`, a subscription that
  is **already established** when it returns. That last one is load-bearing, not
  sugar: a `Stream` is lazy, so "subscribe, THEN cause the event I assert on" must
  issue the first pull, or the producer never registers. Under the oRPC identity
  link that hop happened inside `await client.<member>.get(...)`, which is why the
  laziness was invisible; the `activity` corpus test (a purely live feed with no
  snapshot frame) is where it bit, and it is fixed at the seam rather than per test.
- Every `AbortController` + `ac.abort()` teardown became `iterator.return()` — the
  same teardown production gets, since interruption IS the unsubscribe.

## 6. Gates

```
pnpm --filter kaval typecheck                 → 0 errors
biome lint --error-on-warnings packages/kaval → clean, 40 files
biome format packages/kaval                   → clean (scoped, not repo-wide — a
    sibling agent shares this worktree; same choice S4 and surface-daemon made.
    No .nix file changed, so nixpkgs-fmt is moot.)
KOLU_DAEMON_TESTS=1 pnpm --filter kaval test:unit
                                              → 20 files, 200 passed / 5 failed
```

Zero `zod` / `@orpc/*` **imports** remain in `packages/kaval/src`; the only
surviving mentions are prose recording what was replaced.

### The 5 red tests — all `kaval-tui`, none `kaval`

Every kaval-owned test is green, including the full contract corpus over a REAL
spawned daemon's socket, the gate race, SIGTERM teardown, the PTY-leader reaps and
the `overflow` frame crossing a real socket.

The 5 failures are in `socketDaemon.test.ts` and they all `spawn` the **kaval-tui
binary**, which is W5's package and still un-migrated. They fail before reaching
any assertion, with:

```
packages/kaval-tui/src/wait.ts:33
import { isDeadTransportError } from "@kolu/surface/client";
SyntaxError: … does not provide an export named 'isDeadTransportError'
```

(S3 moved the predicates to `@kolu/surface/errors`; `kaval-tui/src/connect.ts`
additionally still calls `unixSocketLink<T>({socketPath}).client`, which no longer
exists.) They were left red rather than skipped: a skip would hide a real
integration gap, and the fix is a W5 edit in another package. **They go green with
W5, with no further change here.**

## 7. Hand-offs

### For padi (W4) — its dial/endpoint code consumes these types next

1. **`PtyHostClient` moved** to `kaval`'s `./ptyHostClient.ts` (still re-exported
   from `index.ts`). Build one with **`ptyHostClientOver(link.dispatch)`** — do not
   re-derive the cast.
2. **Dial**: `unixSocketLink({ group: ptyHostSurface.group, socketPath })` →
   `{ dispatch, dispose }`. `dispose()` is **async** and is the ONLY thing that
   releases the link's protocol fibers. For a client that needs the control
   sibling too, dial over
   `ptyHostSurface.group.merge(kavalControlSurface.group)` (or `kavalDaemonGroup`)
   and build the control face with
   `buildSurfaceFace(kavalControlSurface, dispatch).surface.core`.
3. **Every stream member changed shape**: `(input) => Stream<T>`, synchronous and
   lazy. `terminalEndpoint/local.ts`'s `bridgeStream` / `resubscribeStream` (the
   VT-tap fan-in) is the biggest site. Its `for await` becomes `Stream` consumption;
   its `AbortController`s become fiber interruption. Note the laziness trap in §5
   — a tap that must not miss an event it is about to cause has to be RUNNING, not
   merely constructed.
4. **`system.version` inputs are the ENCODED side.** `PtyHostSpawnInput` is now
   `Schema.Encoded`, so a composer holding an already-decoded value is fine but a
   consumer that assumed `z.output` semantics should re-read.
5. **Errors**: `NOT_FOUND` → `PtyNotFound` (`_tag`, plus an `id`), `BAD_REQUEST` on
   spawn → `SpawnArgvEmpty`. Narrow on `_tag`, never on a code. On a STREAM member
   `PtyNotFound` arrives as a DEFECT over a wire (§3) — code that branched on the
   NOT_FOUND code for the attach stream needs a different signal (the `exit`
   tombstone, which is what kaval-tui already falls through to).
6. **Drain refuses with a defect**, not a `PRECONDITION_FAILED` member error. Any
   `error.code === "PRECONDITION_FAILED"` check must go.
7. **`PTY_HOST_CONTRACT_VERSION` is `"7.0"`.** Padi's `dial.test.ts` /
   `surface.test.ts` hardcode the old value. And its
   `ptyHost/connect.test.ts` fake-daemon harness (`oc.router` over a copied
   contract entry) should be rewritten against `contractSkew.test.ts`'s model:
   serve the LIVE `Rpc` from `ptyHostSurface.group`, over a real socket, and choose
   the version string.

### For kolu-server (W4/W5)

`servePtyHostOverUnixSocket({ socketPath, served, log? })` — pass
`createInProcessPtyHost(...).served`, not a router. `createInProcessPtyHost` no
longer returns `router` or `servedRouter`.

### For kaval-tui (W5)

`connect.ts`, `attach.ts`, `wait.ts`, `main.ts` and `history.test.ts` are the wire
touchpoints. `isDeadTransportError` now lives in `@kolu/surface/errors`;
`unixSocketLink` returns `{ dispatch, dispose }`; build the face with
`ptyHostClientOver`. Five kaval tests turn green when this lands.

## 8. API-break list additions (drishti / odu follow-up)

1. `PtyHostClient` is `SurfaceClientOf<typeof ptyHostSurface.spec>`; stream members
   return `Stream`, procedure inputs are the Encoded side, no `AbortSignal`.
2. `PtyHostRouter`, `kavalDaemonContract`, `KavalDaemonRouter` **deleted**.
   `createInProcessPtyHost().{router,servedRouter}` → `.served: { group, handlers }`.
3. NEW: `ptyHostClientOver`, `PtyHostServed`, `kavalControlSurface`,
   `kavalDaemonGroup`, `KavalDaemonSurface`, `PtyNotFound`, `SpawnArgvEmpty`.
4. `servePtyHostOverUnixSocket({ router })` → `({ served })`.
5. `PtyHostSpawnInput` is the ENCODED side; `writeInitFiles` takes a `readonly` array.
6. Every exported schema is an Effect `Schema`, not a `ZodType`:
   `.shape` → `.fields`, `.parse` → `Schema.decodeUnknownSync`. Encoded bytes
   unchanged (byte-pinned), so nothing on the wire or on disk migrates.
7. `PTY_HOST_CONTRACT_VERSION`: `"6.0"` → `"7.0"`.

## 9. Nothing here invalidates a PLAN assumption

- **D6 holds**, with the version-constant bullet followed literally and the epoch
  documented in the same commit that changes the wire. The in-epoch mechanism is
  exercised, not merely preserved.
- **D4** is realised on both channels, and the one place the framework cannot
  declare (streams) is named and attributed rather than papered over.
- **D1/#16** is closed for the daemon composition by construction (sibling prefix)
  AND by assertion (size + literal key set).
- **#17** is applied field by field, with byte fixtures for every hit-list shape.
- **D2/#13** lands where it bites: procedure/stream inputs moved to the Encoded
  side, and `PtyHostSpawnInput` says so in its name.
- **PLAN rule 8**: two `as any` casts were DELETED (`Router<any, any>`); one
  `as unknown as PtyHostClient` was added, in ONE place, with the structural
  reason recorded — it is the same cast `surfaceClientRef` makes, for the same
  reason (`SurfaceFace` is deliberately structural per D2). One `noExplicitAny`
  biome-ignore was added in a TEST for the spec's erased schema type; both
  `noExplicitAny` ignores in SOURCE are gone.
- No `package.json` `dependencies` block changed ⇒ standing rule 5 does not fire.
