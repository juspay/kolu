# Hydrating kolu from another repo

kolu ships **raw TypeScript**. A consumer does not `npm install` it; it copies
package *directories* out of a content-addressed pin and lets its own compiler
resolve their imports from its own root `node_modules`. That is deliberate — it
is what surfaced three contract gaps in an out-of-repo consumer's `tsc` before
[#2216](https://github.com/juspay/kolu/pull/2216) merged, which a published
tarball would have traded away — but it means the consumer has to know **which
directories** to copy, and that is more than the ones it imports.

Two files here answer that, so a consumer stops answering it by hand.

## `consumer.nix` — seeds in, closure out

```nix
# nix/kolu.nix, in a consumer
let koluSrc = (import ../npins).kolu;
in import "${koluSrc}/nix/consumer.nix" {
  inherit pkgs;
  src = koluSrc;
  # The packages you actually IMPORT. That is all you maintain.
  seeds = [ "@kolu/padi-client" "@kolu/solid-dockrow" "@kolu/surface-app" ];
}
```

Back come `names`, `dirs`, `externals`, `packages`, `overlay`, `hydrateArgs` and
`hydrateScript` — see the header of `consumer.nix` for what each is. The two
callers that need the argv (a dev-shell `install` recipe and the build
derivation) both pass `hydrateArgs`, so neither re-lists the set:

```
sh ${kolu.hydrateScript} ${kolu.hydrateArgs}
```

The list this replaces was real and it was expensive: one consumer's hand-kept
`names` grew from 7 entries to 30, one line at a time, each added by whoever hit
the next `TS2307`. It was a manual re-derivation of a walk this repo already
runs in its own guards.

## `consumer-closure.json` — the adjacency it walks

Every workspace member, its directory, its workspace dependencies, and its
external dependencies with the ranges its manifest declares. Emitted from those
manifests by `scripts/emit-consumer-closure.ts`, and **checked fresh** by
`just test-e2e-governance` — a manifest edit that does not reach it fails kolu's
own gate rather than a consumer's compiler.

Regenerate it with `just emit-consumer-closure` after adding a package or
changing any manifest's `dependencies`.

It is committed rather than computed on demand because Nix cannot execute
anything at eval time and the hydrate argv is needed at eval time. It is
seed-AGNOSTIC on purpose: one artifact serves every consumer, and adding a
consumer adds nothing to this repo.

**A `catalog:` dependency is refused by name.** `consumer.nix` throws at eval if
your seed closure reaches a package whose manifest carries pnpm's
workspace-catalog protocol, naming the package and the dependency. Such a
package is not yet set up for outside consumption — the vendored set is what
puts a manifest under the literal-version gate — and the alternative is a
resolver error, or a dependency guard failing on a range it cannot parse, with
no clue which package caused it. `@kolu/xterm-kit` is the standing case; its
README says what adopting it takes.

**Read `externals` too.** Those ranges are what your own root manifest has to
install — a range you do not have is a resolution failure waiting to happen in
your compiler, not in kolu's. (A vendored manifest may never spell `catalog:`,
which is workspace-local; kolu's Effect-pin gate enforces literal versions
across exactly the set consumers vendor.)

## `scripts/hydrate-kolu-packages.sh` — the copier

The canonical copy lives in kolu and arrives with the sources it copies. It used
to live in each consumer — one repo wrote it, another copied it, and the two
bodies were kept byte-identical by a comment in each saying so. Comment-
discipline is not a mechanism: nothing failed when they diverged, and what a
divergence causes (a stale tree in one repo's `node_modules`) does not look like
a script bug.

`cp -rL`, never a symlink: TypeScript resolves transitive imports from the *real*
file location, and a symlink into `/nix/store` has no adjacent `node_modules`.

## Which packages are meant to be hydrated

Any of them can be, but two are *declared* out-of-repo entry points in
`packages/tests/governance/vendorEntries.ts` — `@kolu/padi-client` (the padi
contract, dial and vocabulary) and `@kolu/solid-dockrow` (the Dock terminal row).
Being listed there is what puts a package and its whole manifest closure under
the literal-version gate. The `@kolu/surface*` stack is derived from the tree
rather than listed, so a new surface package joins by existing.
