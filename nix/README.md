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
  # PINNED members you must supply yourself — this seed set reaches one.
  # `.pins` lists them WITH the pin, revision and subdirectory to graft, and
  # omitting one is a named throw rather than a broken `cp`. The revision comes
  # back as well as the bytes, because kolu compiles this package against its
  # OWN revision of it: pass a different one and you are told here, at eval,
  # instead of finding out when a field moves.
  pinnedSources.osfacts-client = {
    # `pins.<member>.subdir`, never a hardcoded "/client-ts": the whole point of
    # `pins` is that a consumer reads kolu's answer rather than carrying a second
    # spelling of it. Only the REVISION half is checked at eval; a wrong subdir
    # fails as a broken `cp`, which is exactly the failure mode the named throw
    # in `sourceFor` exists to replace.
    src = pkgs.runCommand "osfacts-client" { }
      "cp -r ${(import ./npins).osfacts}/${kolu.pins.osfacts-client.subdir} $out";
    revision = (import ./npins).osfacts.revision;
  };
}
```

Back come `names`, `dirs`, `externals`, `pins`, `packages`, `overlay`,
`hydrateArgs` and `hydrateScript` — see the header of `consumer.nix` for what each is. The two
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

**`osfacts-client` still has to be COPIED, even though nothing compiles it.**
Two different questions, and kolu#2217 only closed one of them. Your `tsc` no
longer resolves it — the daemon leaf entries mean no published padi-client entry
reaches `endpoint.ts`, so there is no second pin to graft *for typechecking*,
which is what `@kolu/padi-client`'s README means by "no pin to add". But
hydration is per-MANIFEST: you still copy `@kolu/surface-daemon-supervisor`'s
directory, and its manifest still names `osfacts-client`. So the DECLARED
closure still contains it and `consumer.nix` still needs a source for it. That
is why the example above passes `pinnedSources`.

**And it has to be kolu's REVISION of it.** You graft those bytes from your own
pin and then compile them against packages copied from kolu's — two revisions of
one package in one `tsc`, which typechecks right up until a field moves. That
pairing used to be each consumer's to hold, one shell script per repo, every one
of them re-deriving kolu's answer by reading kolu's INTERNAL `npins/sources.json`
out of the fetched archive — a file layout kolu never promised to keep. kolu knows
its own revision, so `consumer-closure.json` carries it (`pin: { name, revision,
subdir }`) and `consumer.nix` refuses a `pinnedSources` entry that disagrees. The
script is yours to delete; `npins add --at` the revision `.pins` names.

**A seed must be a package kolu supports consuming.** `consumer.nix` throws at
eval if a SEED is not a declared `vendorEntries.ts` entry or in its closure —
because being in that set is what puts a manifest under the literal-version
gate. Outside it, resolvable-today is a coincidence, not a promise. The closure
may still REACH an unvendored member; seeding one is you saying "I import this",
which is the claim kolu has to be able to honour.

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


## The rule: a hydratable package cannot declare `catalog:`

**Any kolu package meant to be hydrated by an outside repo must spell literal
dependency versions.** `catalog:` is pnpm's workspace-catalog protocol; the
catalog lives in kolu's own `pnpm-workspace.yaml`, so the specifier resolves
only here. A consumer that vendors the directory and installs its declared
dependencies from its own manifest gets a range its resolver cannot understand,
and a dependency guard comparing ranges literally fails with no clue which
package caused it.

This has cost two real consumers two workarounds (2026-08): `@kolu/xterm-kit`,
where a live terminal pane went to plain `xterm.js` instead; and
`kolu-common/config`, where a consumer needing ONE integer
(`DEFAULT_FONT_SIZE`) vendored a self-deleting copy with import-me-when-it-lands
instructions. In both cases the alternative was a hand-maintained guard
exception — the same hand-kept residue this tooling exists to delete — so
routing around it was the right call, and the package is what should change.

`consumer.nix` refuses such a dependency **by name** at eval rather than
emitting it, so the next consumer learns which package and which dependency
instead of debugging a resolver.

### Which packages carry one — derive it, don't trust this list

```bash
node -e 'const c=require("./nix/consumer-closure.json");
for (const [n,m] of Object.entries(c.members)) {
  const k=Object.entries(m.external).filter(([,v])=>v==="catalog:").map(([d])=>d);
  if (k.length) console.log(n, "→", k.join(", "));
}'
```

At the time of writing that is **20 packages**, and the split is what matters:

- **12 are apps, bins and examples** (`kolu-client`, `kolu-cli`, the TUIs, the
  `surface` examples). Nobody hydrates an app, so `catalog:` is harmless there
  and should stay — the catalog is a real convenience for in-repo code.
- **7 have an `exports` map** and so are importable by name:
  `@kolu/artifact-sdk`, `@kolu/padi`, `@kolu/serve-dir`, `@kolu/xterm-kit`,
  `kaval`, `kolu-common`, `kolu-mcp`. Of those, `@kolu/padi` and `kaval` are the
  daemon tier and are *deliberately* not hydratable — that separation is the
  whole argument for `@kolu/padi-client`. The remainder are latent traps: they
  look importable and are not.

**Being in `vendorEntries.ts` is what makes a package hydratable**, because that
is what puts its manifest — and its whole closure — under `effectPin.ts`, the
gate that requires literal versions. There is no gate for "a package someone
might want later", and there shouldn't be: intent is not derivable. What is
derivable is the list above, and the eval-time refusal.

### `catalog:` is not always the whole cost

`@kolu/xterm-kit`'s closure is **1** workspace member, so removing `catalog:`
makes it genuinely hydratable. `kolu-common`'s is **28** — so a consumer that
wanted one integer out of `kolu-common/config` would still be installing
twenty-eight directories for it. There the honest fix is not only the
specifier: a constant with no dependencies belongs in a leaf that has none
either. Check the closure before assuming a literal version is the fix:

```bash
nix eval --impure --expr '(import ./nix/consumer.nix {
  pkgs = import <nixpkgs> {}; src = ./.; seeds = [ "@kolu/padi-client" ];
}).names'
```

## Which packages are meant to be hydrated

Any of them can be, but four are *declared* out-of-repo entry points in
`packages/tests/governance/vendorEntries.ts` — `@kolu/padi-client` (the padi
contract, dial and vocabulary), `@kolu/solid-dockrow` (the Dock terminal row),
`@kolu/detect` (the "is there a usable kolu on this host" probe) and
`terminal-themes` (the theme catalog, so a consumer's live pane paints a padi
terminal the way kolu paints it rather than in xterm's default).
Being listed there is what puts a package and its whole manifest closure under
the literal-version gate. The `@kolu/surface*` stack is derived from the tree
rather than listed, so a new surface package joins by existing.
