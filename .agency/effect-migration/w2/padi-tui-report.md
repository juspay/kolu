# W5 — `padi-tui`: the client tier on the Effect face

Scope delivered: `connect.ts`, `hostConnect.ts`, `read.ts`, `create.ts`, `main.ts`,
`render.ts` and the four test files. `package.json` untouched, so PLAN standing
rule 5 does not fire.

The headline is how LITTLE moved. `recon/consumers.md` scored this package
"difficulty: none (no oRPC at all)" and that held: **three compile errors** in the
whole CLI, all at the two seams the migration actually changed shape — the remote
dial's face and the `keys` collection read. The verbs (`status` / `watch` / `wait`
/ `create`), their output formats, their exit codes and their flag grammar are
byte-for-byte what they were. That is the payoff of the package having always
gone through `@kolu/padi/dial` and `@kolu/surface/*` rather than around them.

---

## 1. The three real changes

### 1.1 `hostConnect.ts` — there is nothing left to SCOPE

```diff
-  client: scopePadiSurface(dial.client),
+  client: dial.client as unknown as PadiTuiClient,
```

`dialPadiViaHost` opens the ssh link with `padiRemoteDialSurface` — padi's SIBLING
spec carried over the full daemon group (padi-A §2.4) — so the face it hands back
ALREADY addresses `surface/padi/<member>`. The old call narrowed a COMBINED client
by walking its `.surface.padi` namespace; that nesting was the oRPC contract's, and
the Effect wire namespace is flat, so a sibling is a tag PREFIX minted at dial time
and there is no second namespace to select. `scopePadiSurface` is now a field read
on a `PadiDaemonClient` — a value the ssh path never produces — so calling it here
would be asking for the wrong shape.

**The cast is real and it is the framework's, not this package's.**
`AgentDial.client` is `AgentClient = SurfaceFace`, deliberately STRUCTURAL: per-member
precision is spec-derived one layer up (D2/#16 — a second precise mapped type over
the same spec is the union-budget blowup the erased seam exists to avoid). So no
spelling of the ssh dial can hand back a padi-TYPED value; `padiClientOver` makes
the identical cast on the local leg. PLAN rule 8 satisfied: the constraint is stated
at the site.

It is also checked where it CAN be — the dial's own `probe` reads `identity`
through this very face and refuses a version-skewed padi before the line is
reached, so a face that could not address padi's members never gets here.

**The one-line deletion available later**: `packages/server`'s W5 agent is adding
an optional `dispatch` to `AgentDial` (uncommitted at the time of writing). Once it
lands, this becomes `padiClientOver(dial.dispatch).padi` with a loud throw on
`undefined`, and the cast goes. Deliberately NOT taken here — it is another agent's
in-flight API and this package must not be the thing that pins it. `dial.ts` already
carries the matching note for its own probe; both are one edit away when the field
is real.

### 1.2 `read.ts` — the lazy `keys` stream

```diff
-    await client.surface.terminals.keys({}),
+    Stream.toAsyncIterable(client.surface.terminals.keys(undefined)),
```

`SurfaceCollectionsReadFace` (dial.ts) makes `keys` a
`StreamingProcedure<undefined, readonly TerminalId[]>`: a LAZY `Stream` returned
synchronously, no `signal` option (D10/#18). Three consequences, all stated in the
docstring rather than absorbed:

1. **Teardown is the `for await` return.** `firstFrameOrThrow` RETURNS out of its
   loop, which calls the async iterator's `return()`, which interrupts the
   subscription. That is now the ONLY thing that closes it — a one-shot read that
   stopped returning early would leak a live `keys` subscription per
   `wait`/`create --parent` for the life of the link. Pinned by a new test that
   observes the iterator's `return()` actually firing (§3).
2. **Sync throws still arrive as rejections.** The `Stream` is built inside the
   `async` body, so a wrong-surface client that throws at the member ref surfaces
   on the promise, not past the caller's `await` — S3 §6's hazard, closed by
   placement rather than by a `try`.
3. **The return type is `readonly TerminalId[]`** (decoded values are readonly now).
   `resolveTerminalId` and `resolveOne` widened their parameter; nothing copies.

`settledSnapshot` did NOT move. `mirrorRemoteSurface` kept its `{ signal, log }`
options deliberately — S3 §6: the top-level `signal` "is the non-Effect consumers'
cancellation vocabulary, translated into one interrupt at this edge" — and this CLI
is exactly that consumer. So the hard cap, the grace timer, the `stopped`/`linkFailed`
latch and the caught-error-must-not-collapse-to-empty throw are unchanged, and the
regression they exist for is still pinned by the same test.

### 1.3 Prose that had gone stale

Three comments named oRPC as the thing a failure would otherwise happen "deep
inside" (`connect.ts`, `main.ts`) or described the remote probe as reading the
control core's `hello` (`hostConnect.ts`, now padi's `identity` cell — padi-A §2.4).
Corrected, not left to rot.

---

## 2. What deliberately did NOT change

- **`create.ts`** — procedures are still `(input) => Promise<Out>`; the input moved
  to the Encoded side but every field it sends is a `string`, so the call sites are
  identical.
- **`main.ts`'s dispose seam.** `Connection.dispose` stays SYNCHRONOUS.
  `PadiDial.dispose` is async now (padi-A §2.3), but both dial paths this CLI uses
  hand back a sync one — `connectPadi` fires the async release behind its own
  `DaemonConnection.dispose`, and `AgentDial.dispose` is `() => void`. Making this
  one async would buy nothing: every verb ends at `process.exit(0)`, which is also
  why no Effect fiber can hold the CLI open.
- **`watch` / `wait`.** `watchTerminals` and `awaitAgentState` kept their
  AbortSignal-shaped signatures in the dial kit, so `cmdWatch`/`cmdWait` — including
  the `abortOnShutdownSignals` wiring, the EPIPE hang-up abort, and the
  un-aborted-settle-is-a-failure rule — compile and behave unchanged.
- **No retry fence, on purpose.** A member ref hands back a RAW, unfenced `Stream`
  (S3 §1.1); the fence is the consumer's to apply. A one-shot CLI must FAIL on a
  transport drop, not retry forever — `main`'s single `.catch` turns it into
  `padi-tui: <message>` and exit 1, which is what `status`/`wait` already promised.

---

## 3. Tests: 22 → 28, nothing deleted

The `read.test.ts` harness had to be ported: its fake client returned
`Promise<AsyncIterable>` per verb with an `AbortSignal` option, and the mirror now
calls `keysFn(undefined)` / `get({key})` expecting a `Stream` back. `FakeStream` →
`FakeSource`, `iterable(signal)` → `stream()` returning
`Stream.suspend(Stream.fromAsyncIterable(…))` — suspended so each subscribe gets its
own replay cursor, exactly like a real member ref.

**The iterator deliberately has no `return` method.** `Channel.fromAsyncIterable`
registers a teardown finalizer only when one exists, and that finalizer AWAITS what
`return()` resolves — an async iterator parked on an unsettled `next()` would never
resolve it, so the finalizer would hang scope close instead of performing it. Same
shape the framework's own pushable fakes use (`collectionDeltasGate.test.ts`).
Written down in the fake, because it reads like an omission and is not.

Six new `it`s, each pinning something the port put at risk and nothing pinned
before:

| file | test | why it exists |
|---|---|---|
| `read.test.ts` | first frame of a still-LIVE `keys` stream, **and the iterator's `return()` fired** | teardown is now the ONLY thing closing a one-shot read; nothing observed it |
| `read.test.ts` | an EMPTY `keys` stream THROWS | zero terminals is a defined empty ARRAY; an empty STREAM is a link failure. Collapsing them makes `wait <id>` say `no terminal matching <id>` and `status` print a blank table |
| `read.test.ts` | a stream FAILURE arrives as a rejection | the sync-throw hazard of §1.2(2) |
| `create.test.ts` ×3 | the create payload OMITS absent optional keys | **PLAN #17.** `PadiCreateInputSchema` spells `cwd`/`parentId` with `Schema.optionalKey`, which REFUSES an explicit `undefined` where zod tolerated it. A `{ cwd, parentId }` shorthand would encode-fail on the commonest create there is. Asserted with `Object.keys` — `toEqual`/`toHaveBeenCalledWith` treat an `undefined`-valued key as absent, which is precisely the distinction |

`hostConnect.test.ts`'s fake was a COMBINED client with a `.surface.padi` namespace
— a shape the new dial cannot produce. It now fakes the padi face and asserts
**identity** (`connection.client` IS `dial.client`), which is the stronger and now
truer statement: re-wrapping would be a second authority on where padi's tags live.

`awaitAgentState`'s two live-behaviour tests stay HERE, over this consumer-side
harness, as `padi/src/watch.test.ts`'s header requires.

---

## 4. Gate

```
pnpm --filter padi-tui typecheck                  → 0 errors
pnpm --filter padi-tui test:unit                  → 4 files, 28 tests, ALL GREEN
biome lint --error-on-warnings packages/padi-tui  → clean (12 files)
biome format packages/padi-tui                    → clean
grep '@orpc' | grep 'from "zod"' over src/ + package.json → NO hits
```

**Smoke, beyond the gate**: `tsx src/main.ts --help` runs the real binary end to
end — which loads the whole `@kolu/padi/dial` → `padiSurface` graph including
padi-A's IMPORT-TIME `PADI_DAEMON_TAG_COUNT` assertion — and prints
`padi-tui v5.0`, i.e. the epoch-bumped `PADI_SURFACE_VERSION` read off the new
contract.

**Not run: a live dial against a real padi.** Booting one from source needs the
baked Nix env (`KOLU_OSFACTS_BIN`, and padi refuses to run inside a devshell), and
`packages/server` was still in flight in this worktree. That is PLAN W5's
`dev-smoke` and W7's e2e, both of which cover this CLI; flag it if either slips.

---

## 5. Public API breaks (for the drishti/odu follow-up list)

`padi-tui` is a private binary with no downstream, so nothing here is a break for
anyone else. Two internal signature widenings, recorded for the next reader:

1. `readTerminalKeys(client)` returns `Promise<readonly TerminalId[]>` (was
   `TerminalId[]`).
2. `resolveTerminalId(query, ids)` takes `readonly TerminalId[]`.

## 6. One limitation worth naming

`PadiSurfaceClient`'s procedure arms resolve to `(input) => Promise<Out>` — the
DECLARED error union (padi-A §3: `WorktreeNameCollision`, `GitFailed`, …) is not
carried on the return type, so `safe()`/`ProcedureResult` narrowing is not
available through this face the way it is through the Solid `BoundProcedure`.
padi-tui does not narrow — every failure is printed as its `.message` and exits 1,
and the tagged classes reproduce the `ORPCError`-era sentences verbatim, so the
operator-visible behaviour is unchanged. If a future verb wants to BRANCH (e.g.
`create --worktree` offering a different name on a collision), `SurfaceReadFace`'s
procedure ladder in `@kolu/surface/project` is where the error channel would have
to be threaded — not here.
