# mkWorkspaceClosure — the THIRD piece of the daemon-identity capability, next to
# `daemon-identity.nix` (bake the id) and `agent-source.nix` (bake a provable source tree).
# Those two answer "how is an identity baked"; this one answers the question that has to be
# settled first: WHAT should it hash?
#
# Location is structure, the same argument as its siblings: a daemon's identity recipe and
# the derivation of its behavioral closure are two halves of one capability, so they live
# INSIDE `@kolu/surface-daemon` — kolu's `nix/workspace.nix` imports this file rather than
# owning the walk, and an external spine consumer (drishti, odu) gets the same mechanism
# from the same box as the code that reads the baked id (juspay/kolu#2096).
#
# ── Why DERIVE the fileset instead of listing it (juspay/kolu#2094) ──────────────────────
# A hand-kept list of "the files this daemon loads" is a second copy of a fact the manifests
# already state, and it drifts silently: a new dependency lands, nobody edits the list, and
# a REBUILT daemon ships an UNCHANGED identity — a supervisor then adopts stale code
# believing it current. Deriving the set from the package.json `dependencies` graph makes
# forgetting unspellable, and moves the residual failure into the safe direction: the walk
# can only ever include TOO MUCH (an unnecessary staleKey flip — a cheap drain or an early
# nudge), never too little. The one assumption it rests on — every import a daemon can
# reach is declared in the importing package's `dependencies`, never a devDependency — is
# what `@kolu/daemon-test-gate`'s `walkRuntimeDepEdges` guard enforces on the TS side.
#
# ── Members may be LOCAL or PINNED, and the kind is DECLARED (juspay/kolu#2093) ──────────
# The edge rule is "the target name is an attrname of `members`", not "the version spec says
# `workspace:`", so the walk crosses a PIN boundary: a consumer that vendors a package from
# a content-addressed fetch (npins, a submodule) instead of its own pnpm workspace lists it
# in `members` as a store path and it joins the closure like any other member. A pinned
# member contributes its WHOLE store path to the id (`pinnedSources`), not a file-level
# fileset — deliberately coarse, because a pin bump is ATOMIC: the pin's hash already moves
# iff any byte behind it moved, and per-file granularity inside someone else's pinned tree
# would only buy back flips that a pin bump was an explicit act of adopting. Dropping such
# a member instead (the shape kolu's osfacts-client graft takes) is precisely the silent
# stale-daemon hole #2094 recorded, so it flows into the id by construction.
#
# WHICH members are pins is DECLARED — the `pinned` argument, a list of member NAMES — and
# never inferred from how a value happens to be SPELLED. Spelling-inference was one source
# with two semantics, and it got both ends wrong. A pin subdirectory written as a path value
# read as LOCAL and then died deep inside `lib.fileset` with a message that never named the
# cause. A LOCAL member whose root genuinely IS a store path — a single-package consumer's
# `./.` under a flake eval, where the sources are copied to `/nix/store/…-source` — read as
# PINNED and had its `behavioralFileset` silently EMPTIED, i.e. a daemon whose id stopped
# tracking its own source. With the kind declared, each member's value is type-CHECKED
# against the declaration (a pin is a STRING already coerced into the store; a local is a
# PATH literal), so both of those become a loud eval error that names the member.
#
# ── `mustCover` — the pinned consumer's tripwire ─────────────────────────────────────────
# In a pnpm monorepo a stale `members` map is caught by the `workspace:` rule below: that
# protocol is only spellable for a workspace member, so an edge using it whose target is
# missing throws. A PINNED consumer has no such tell — it spells a pinned edge however its
# manifest spells a pin (a version, a `file:`, a catalog entry), which is indistinguishable
# from an ordinary external npm dependency. `mustCover` restores the tripwire by NAME:
# name the prefixes whose packages must always be members (`[ "@kolu/" ]`), and a framework
# package that silently goes external — resolved from the registry, invisible to the id —
# fails eval instead of quietly leaving the daemon's behavioral closure.
#
# ── The sanctioned ALTERNATIVE ───────────────────────────────────────────────────────────
# A consumer whose daemon is built from a small, NARROWED inner derivation can skip this
# walk entirely and hash that derivation's own store path — drishti's pattern; the trade
# (the id then moves with the runtime engine too) is written up on the "bake an identity"
# docs page.
{ lib }:
let
  # `+` is the one join that reads both member shapes: `path + "/x"` yields a path, and
  # `string + "/x"` a string, so a local dir and a pinned dir need no separate spelling here
  # (`importJSON`/`fileFilter` take either). The KIND of each dir is asserted at the door of
  # `mkWorkspaceClosure`, so nothing downstream has to ask which one it is holding.
  manifestOf = dir: lib.importJSON (dir + "/package.json");

  # The `.ts`/`.tsx` filter for a hashed fileset: real runtime source only — drops
  # `.test.ts`/`.test.tsx` unit tests, `.test-d.ts` type pins, and `.testlib.ts` shared
  # test-only helpers. The id is a content hash of the fileset's store path, byte-identical
  # across Darwin/Linux; the recipe + rationale live in `mkDaemonIdentity`.
  defaultIsHashedSource =
    f: (f.hasExt "ts" || f.hasExt "tsx")
      && !lib.hasSuffix ".test.ts" f.name
      && !lib.hasSuffix ".test.tsx" f.name
      && !lib.hasSuffix ".test-d.ts" f.name
      && !lib.hasSuffix ".testlib.ts" f.name;
in
{
  inherit defaultIsHashedSource;

  # `members`: package name → package dir. A LOCAL member's dir is a PATH literal
  # (`../packages/foo`); a PINNED member's is a STRING already coerced into the store
  # ("${pins.kolu}/packages/surface").
  # `pinned`: the member NAMES that are pins — the DECLARATION (see the doorstep note); the
  # value shapes above are asserted against it rather than sniffed out of it.
  # `mustCover`: name prefixes that must never resolve outside `members` (see the doorstep).
  mkWorkspaceClosure = { members, pinned ? [ ], mustCover ? [ ] }:
    let
      isPinned = name: lib.elem name pinned;
      unknownPinned = lib.subtractLists (lib.attrNames members) pinned;

      # Every member is checked ONCE, here, and the rest of this file reads `checked` — so a
      # bad member can only ever surface as one of these messages, never as a failure deep
      # inside `lib.fileset`/`importJSON` that names a path instead of a cause. Two facts per
      # member: its VALUE SHAPE matches its declared kind, and its KEY matches the
      # package.json `name` (a renamed or mis-keyed package would silently orphan its
      # dependency edges, and an orphaned edge is behaviour missing from a daemon's id).
      # `foldl'` is strict in its accumulator, so forcing `checked` at all runs every
      # assertion.
      checked =
        assert lib.assertMsg (unknownPinned == [ ])
          "mkWorkspaceClosure: `pinned` names packages that are not members (stale or mistyped): ${toString unknownPinned} — every entry of `pinned` must be a key of `members`";
        lib.foldl'
          (acc: name:
            let dir = members.${name}; in
            assert lib.assertMsg (if isPinned name then builtins.isString dir else builtins.isPath dir)
              (if isPinned name then
                "mkWorkspaceClosure: member '${name}' is declared in `pinned`, so its dir must be a STRING naming a store path (e.g. \"\${pins.kolu}/packages/x\"), but it is a ${builtins.typeOf dir}. Coerce the pin to a string: a path-typed value makes eval NAR-copy the pinned tree into the store under a FRESH hash, so the identity would track that copy instead of the pin."
              else
                "mkWorkspaceClosure: member '${name}' must be a PATH literal — its files are read into the hashed fileset — but it is a ${builtins.typeOf dir}. If this member is a pin, list its name in `pinned`.");
            assert lib.assertMsg (!isPinned name || lib.hasPrefix "${builtins.storeDir}/" dir)
              "mkWorkspaceClosure: member '${name}' is declared in `pinned`, so its dir must be under ${builtins.storeDir}/, but it is '${dir}'. A pin is content-addressed bytes; a mutable path would make the identity a lie.";
            let actual = (manifestOf dir).name or null;
            in
            assert lib.assertMsg (actual == name)
              "mkWorkspaceClosure: members key '${name}' does not match package.json name '${toString actual}' at ${toString dir}";
            acc)
          members
          (lib.attrNames members);

      # The transitive closure of `entries` over package.json `dependencies` edges whose
      # TARGET is a member — the same edges pnpm's isolated node_modules (and a pin's own
      # directory) make the only resolvable ones at runtime, so "what code can this package
      # load" is answered by the manifests, not by a hand-kept list. devDependencies are
      # deliberately NOT followed: they never ship behaviour (the dependency-edge guard
      # tests enforce that no runtime import rides one). A non-member target is an ordinary
      # external dependency and ends the edge — unless one of the two loudness rules below
      # says it cannot be.
      #
      # `stop` names packages the walk treats as OPAQUE LEAVES: each is excluded from the
      # result together with everything reachable ONLY through it (a daemon that
      # deliberately keys currency on a slice excludes a leaf's whole subtree, not just its
      # top — see kolu's default.nix stableLeaves). Every `stop` entry must actually be in
      # the un-stopped closure, so a stale or mistyped leaf fails eval loudly instead of
      # silently naming nothing.
      depClosure = { entries, stop ? [ ] }:
        let
          depsOf = name:
            let
              dir = checked.${name} or (throw
                "mkWorkspaceClosure depClosure: '${name}' is not a member — add it to `members`");
              deps = (manifestOf dir).dependencies or { };
              follow = dep: spec:
                if checked ? ${dep} then true
                # A `workspace:` spec is only spellable for a package pnpm resolves from
                # THIS workspace, so a missing member is a stale map, not an external dep.
                else if lib.hasPrefix "workspace:" spec then
                  throw
                    "mkWorkspaceClosure depClosure: '${name}' depends on '${dep}' via the `workspace:` protocol, but '${dep}' is not in `members` — add it (\"${dep}\" = <package dir>), or the daemon identity silently stops covering that package"
                else
                  let hit = lib.findFirst (p: lib.hasPrefix p dep) null mustCover;
                  in
                  if hit != null then
                    throw
                      "mkWorkspaceClosure depClosure: '${name}' depends on '${dep}', which matches the `mustCover` prefix '${hit}' but is not in `members` — it is resolving from OUTSIDE the pin, so its code is invisible to the daemon identity. Add it to `members` (pointing at the pin), or drop '${hit}' from `mustCover`"
                  else false;
            in
            lib.attrNames (lib.filterAttrs follow deps);
          walk = stopped: map (x: x.key) (builtins.genericClosure {
            startSet = map (n: { key = n; }) entries;
            operator = x:
              if lib.elem x.key stopped then [ ]
              else map (n: { key = n; }) (depsOf x.key);
          });
          full = walk [ ];
          stale = lib.subtractLists full stop;
        in
        assert lib.assertMsg (stale == [ ])
          "mkWorkspaceClosure depClosure: stop entries not in the dependency closure of ${toString entries} (stale or mistyped): ${toString stale}";
        lib.naturalSort (lib.subtractLists stop (walk stop));

      # The two identity inputs `mkDaemonIdentity` takes, derived from ONE closure: the
      # daemon package's dependency closure minus its `stableLeaves` (and their exclusive
      # subtrees). A LOCAL member contributes its runtime sources plus its package.json (a
      # dependency/version change is a behaviour change); a PINNED one contributes its
      # content-addressed store path, which stands for exactly the same bytes. The partition
      # is by the DECLARED `pinned` list — the same one the doorstep asserts the value shapes
      # against — so a member cannot land in the wrong arm.
      identityInputs = { entries, stableLeaves ? [ ], isHashedSource ? defaultIsHashedSource }:
        let
          names = depClosure { inherit entries; stop = stableLeaves; };
          pinnedNames = lib.filter isPinned names;
          localNames = lib.filter (n: !isPinned n) names;
        in
        {
          behavioralFileset = lib.fileset.unions (lib.concatMap
            (n: [
              (lib.fileset.fileFilter isHashedSource (checked.${n} + "/src"))
              (checked.${n} + "/package.json")
            ])
            localNames);
          pinnedSources = lib.genAttrs pinnedNames (n: checked.${n});
        };
    in
    {
      members = checked;
      inherit depClosure identityInputs;
    };
}
