# corvu-next's dialog, drawer, resizable and tooltip — and the six helper
# packages they depend on — BUILT from the npins `corvu-next` pin.
#
# kolu's client renders `@corvu-next/*` (the Solid 2 port of corvu). It is a
# workspace graft like osfacts and odu (see nix/workspace.nix), with one
# difference: those members are consumed as SOURCE, and corvu-next's cannot be.
# Each package's own source imports through a per-package `@src/*` path alias,
# which kolu's compiler cannot resolve for ten packages at once; what a consumer
# is meant to read is the package's `dist/` (its `exports` point there). So
# this derivation runs corvu-next's own install and build, and the graft copies
# the BUILT package directories.
#
# What kolu compiles out of `dist/` is the preserved-JSX `index.jsx` behind the
# `solid` export condition (`@solidjs/vite-plugin` resolves that condition
# first) and the `.d.ts` types — never the package's own compiled `index.js`.
#
# THE MANIFEST STAYS AS UPSTREAM WROTE IT, minus `devDependencies` and
# `scripts`. Sibling edges are `workspace:*` upstream, so inside kolu's
# workspace they link to the grafted siblings rather than to the registry. The
# dev dependencies and the scripts are the package's BUILD, already spent in
# this derivation; a graft that kept them would make kolu's lockfile install
# corvu-next's compiler and a recursive `pnpm run build` re-run a build whose
# toolchain is not there — neither of which a registry consumer ever does for a
# dependency.
#
# The output keeps the source layout (`$out/packages/<dir>`), so a member's
# subdirectory names the same place in the pin and in this build.
{ lib, stdenv, nodejs, pnpm-build, pnpmConfigHook, fetchPnpmDeps, jq, src }:
let
  # The ten packages kolu grafts, by their directory under `packages/`. The
  # four kolu imports plus every sibling they depend on; `pnpm --filter X...`
  # below selects the same closure, and the install phase fails if a listed
  # directory did not build.
  dirs = [
    "dialog"
    "drawer"
    "resizable"
    "tooltip"
    "utils"
    "solid-presence"
    "solid-dismissible"
    "solid-focus-trap"
    "solid-prevent-scroll"
    "solid-transition-size"
  ];
  roots = [
    "@corvu-next/dialog..."
    "@corvu-next/drawer..."
    "@corvu-next/resizable..."
    "@corvu-next/tooltip..."
  ];
in
stdenv.mkDerivation (finalAttrs: {
  pname = "corvu-next";
  version = "0-unstable-${builtins.substring 0 8 src.revision}";
  inherit src;

  pnpmWorkspaces = roots;
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src pnpmWorkspaces;
    pnpm = pnpm-build;
    hash = "sha256-GORBFwUDuYrtXUJibqanHyMrQIwGVwhAzhEZZ4iq+T4=";
    fetcherVersion = 3;
  };

  nativeBuildInputs = [ nodejs pnpm-build pnpmConfigHook jq ];

  buildPhase = ''
    runHook preBuild
    pnpm ${lib.concatMapStringsSep " " (r: "--filter=${r}") roots} run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    for dir in ${lib.escapeShellArgs dirs}; do
      from="packages/$dir"
      to="$out/packages/$dir"
      test -f "$from/dist/index.jsx" -a -f "$from/dist/index.d.ts"
      mkdir -p "$to"
      cp -r "$from/dist" "$to/dist"
      cp LICENSE "$to/LICENSE"
      jq 'del(.devDependencies, .scripts)' "$from/package.json" > "$to/package.json"
    done
    runHook postInstall
  '';

  dontFixup = true;
})
