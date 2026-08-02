# W5 — `@kolu/xterm-kit` off oRPC

One site, as recon predicted (`recon/consumers.md` → "mechanical (trivial)"):
`src/scrollbackBackfill.ts`'s backfill controller swallowed a gone-terminal fetch
rejection with `err instanceof ORPCError && err.code === "NOT_FOUND"`. That is the
whole oRPC footprint of the package. It is gone, and with it the last reason this
UI kit imported anything from the RPC stack.

Zero `@orpc/*` and zero `zod` **imports** remain in `packages/xterm-kit/src`; the
only survivor is one line of prose in a doc comment recording what was replaced.

## 1. What the check became — and why it is not a `_tag` compare in this file

The brief's instruction was "`_tag` narrowing on the tagged error the surface now
declares". The narrowing is real; **the predicate moved to the caller**, and the
option is REQUIRED:

```ts
createBackfillController(term, {
  fetch,
  isTerminalGone: (err) => boolean,   // NEW, required
  onError,
})
```

```ts
} catch (err) {
  if (!opts.isTerminalGone(err)) opts.onError(err);
  return;
}
```

The reasoning, in order:

1. **The call path is a PROCEDURE, so the error is DECLARED.** This kit's `fetch`
   is supplied by `client/src/terminal/Terminal.tsx` as
   `activePadiRpc.screen.history(...)`. `padiSurface`'s `screen.history` declares
   `error: TerminalNotFound` (`padi/src/surface.ts:1286`), raised by
   `requireActiveTerminal` in `servePadi.ts:693`. Per S3 §1.1 a unary verb rejects
   with the SQUASHED failure — the tagged-error INSTANCE, `_tag` and `id` intact —
   so it is narrowable, unlike the stream members' undeclared twin
   (kaval-report §3 / padi's `TerminalNotFound` doc: `StreamSpec` has no error
   channel, so there the same value crosses a wire as an opaque defect). Nothing
   about this site needs the stream workaround; the value arrives typed.
2. **This kit has no `@kolu/*` dependency, by design.** Its `package.json` lists
   xterm, `@solid-primitives/*`, `effect`, and (until W6) `@orpc/client`. The
   class it would have to narrow on lives in `@kolu/padi/surface`. Importing it
   here would invert the arrow — a generic terminal UI kit depending on the daemon
   package's app vocabulary — and would need a new dep (forbidden in W5).
3. **Re-spelling the tag as a string literal here would be a second source of
   truth with nothing pinning it.** padi's own cross-wire recognition
   (`terminalEndpoint/reattachingDeltas.ts:39-59`) narrows structurally on `_tag`
   but reads the string **off the class** (`new PtyNotFound({id:""})._tag`)
   precisely so a rename moves it. From xterm-kit the class is unreachable, so the
   literal would be unpinned: a rename in padi would silently stop matching and
   turn every ordinary PTY teardown into a toast — a silent degradation, which is
   the defect class this repo's philosophy forbids. In the oRPC era the leaf could
   legitimately own the check because `ORPCError` + `NOT_FOUND` was a *framework*
   vocabulary it already depended on. D4 replaced that with per-app declared error
   classes, so the recognition has to live where the class does.

So the app supplies the predicate and the kit keeps the *policy* (which channel
tolerates, which fails loud). The deliberate scoping the brief asked to preserve is
intact and now stated in the option's own doc: `isTerminalGone` is consulted for a
**`fetch` rejection only**; a `prepend` fault (headroom overflow, broken xterm
internals) still `pause()`s and goes to `onError` — fail-loud, unchanged.

Not a knob: it has **no default**. A default in either direction (swallow-all or
toast-all) is exactly the silent degradation the `onError`-is-required rule already
exists to prevent, and it is documented as the twin of that rule.

## 2. Tests (ported, +1)

`src/scrollbackBackfill.test.ts` — all 93 kept, none renamed, one added. 94 pass.

- The `ORPCError` import is replaced by a **`Schema.TaggedErrorClass` stand-in**
  for padi's `TerminalNotFound` (id field and all), modelled rather than imported
  for the same dependency reason — which is itself the point the comment makes.
- The predicate the tests pass is written the way an app should write it:
  **structural `_tag`**, with the tag read OFF the class, not `instanceof` —
  S3 §2's rule (a decoded error may come from another module realm; two copies of
  a class in one bundle, a relay hop that decodes and re-encodes).
- `"swallows a gone-terminal NOT_FOUND fetch rejection"` →
  `"swallows a gone-terminal declared rejection"` (same test, new vocabulary), and
  the non-swallowed twin is retitled to name the predicate. Both keep their
  original assertions including the retry-after-fault arms.
- **NEW — `"surfaces a DIFFERENT declared tagged error — the swallow keys on the
  tag, not on 'is tagged'"`.** The one hazard the D4 discriminant change
  introduces: a predicate spelled "did the server declare this?" (the shape
  `isDefinedError` invites) would swallow every declared failure a future member
  gains, silently re-creating the hole the scoping exists to prevent. A second
  tagged error from the same vocabulary must reach `onError`.

## 3. Gates

```
pnpm --filter @kolu/xterm-kit typecheck   → 0 errors
pnpm --filter @kolu/xterm-kit test:unit   → 8 files, 94 passed (was 93)
biome lint --error-on-warnings packages/xterm-kit → clean, 27 files
biome format packages/xterm-kit                   → clean (scoped, not repo-wide —
    sibling agents share this worktree; same choice kaval/S4 made)
```

`noSolidInDaemon.test.ts` (the root-barrel closure guard kaval's daemon depends on)
still passes; the change only removed an import edge, and it sits behind the
`/backfill` subpath the root never loads.

## 4. LOUD — a required API break landing in `packages/client` (W5 sibling)

`createBackfillController` now demands `isTerminalGone`. `packages/client` will not
typecheck until `Terminal.tsx:412` passes it. The exact edit:

```ts
import { TerminalNotFound } from "@kolu/padi/surface";  // already a client dep

backfill = createBackfillController(term, {
  fetch: (before, max, epoch) => activePadiRpc.screen.history({ … }),
  // The one expected teardown: the PTY was killed / exited, so padi rejects the
  // history read with its declared `TerminalNotFound`. `instanceof` is sound
  // here only if the value did not cross a realm boundary — prefer the
  // structural `_tag` compare with the tag read off the class.
  isTerminalGone: (err) => err instanceof TerminalNotFound,
  onError: (err) => toast.error(`Failed to load older scrollback: …`),
});
```

(`@kolu/padi/surface` already re-exports the whole error vocabulary —
`surface.ts:145` `export * from "./errors.ts"` — so the import above resolves
today, no padi-side change needed.)

This is the only consumer in the repo (`grep -rn createBackfillController`).

## 5. For W6

1. **`@orpc/client` can be dropped from `packages/xterm-kit/package.json`** — the
   last import is gone. Standing rule 5 applies: refresh `nix/workspace.nix:178`
   and re-check `default.nix` stableLeaves, and note that **kaval's daemon imports
   this package's root barrel** (`noSolidInDaemon.test.ts`), so this edge removal
   touches a daemon closure.
2. `effect` is declared in `dependencies` (blanket W1 add) but after this change is
   imported by a **test only** — `src/` needs no Effect at all, which is the leaf
   staying framework-free rather than an oversight. W6's call whether it belongs in
   `devDependencies`; flagged, not acted on.

## 6. API-break list additions (drishti / odu follow-up)

- `createBackfillController(term, opts)` gains a REQUIRED
  `isTerminalGone: (err: unknown) => boolean`. There is no default and no
  behavioural fallback: without it the call does not compile.

## 7. Nothing here invalidates a PLAN assumption

- **D4** is honoured at the recognition site: the discriminant is a `_tag` on a
  declared error, never a code — the narrowing simply happens in the package that
  owns the class, which is what D4's "shared vocabulary must be recognised by both
  ends" implies for a leaf that shares neither end.
- **D10** holds: this leaf stays non-Effect and plain-async; it takes a predicate,
  not an `Effect`, and its `fetch` seam is still a `Promise`.
- **Rule 8**: no `as any` added. No `package.json` touched ⇒ rule 5 does not fire
  in this commit (it fires for W6, §5.1).
