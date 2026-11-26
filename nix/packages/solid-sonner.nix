# `solid-sonner`, BUILT from the npins `solid-sonner` pin.
#
# kolu's client renders `<Toaster>` and raises every toast through this package.
# The registry's 1.0.0 derives four lists inside the toaster — the visible
# toasts, the positions in use, and the per-position toast and height slices —
# with no equality gate, so every toast republishes an equal-but-new array and
# wakes the whole toaster subtree; Solid's dev build raises
# `UNSTABLE_MEMO_OUTPUT` on it, which the dev lane fails on. The fix is four
# `equals` options in the library's own source, and it lives in a commit no
# registry release carries yet, so kolu grafts THAT commit the way it grafts
# corvu-next. When the fix is released this pin and this file go away and the
# client takes the published version again.
#
# Consumed as a BUILD, not as source, for the same reason corvu-next is: what a
# consumer reads is `dist/` (the package's `exports` point there), and the
# source's `./styles.css?inline` import only a bundler resolves. kolu compiles
# the preserved-JSX `dist/index.jsx` behind the `solid` export condition, which
# `@solidjs/vite-plugin` resolves first, plus the `.d.ts` types.
#
# THE MANIFEST STAYS AS UPSTREAM WROTE IT, minus `devDependencies` and
# `scripts` — the package's BUILD, already spent here. Keeping them would make
# kolu's lockfile install this package's compiler and re-run a build whose
# toolchain is not in the tree, which no registry consumer ever does for a
# dependency.
#
# THE PIN'S ROOT IS THE PACKAGE (a single-package repository), so the output is
# laid out as the package itself rather than under `packages/<dir>`, and the
# member's subdirectory is `.` in both the pin's source and this build — see
# `pinnedPins` in nix/workspace.nix.
{ stdenv, nodejs, pnpm-build, pnpmConfigHook, fetchPnpmDeps, jq, src }:
stdenv.mkDerivation (finalAttrs: {
  pname = "solid-sonner";
  version = "0-unstable-${builtins.substring 0 8 src.revision}";
  inherit src;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm-build;
    hash = "sha256-5qwxpvg/DJpTHF+E1vrvzX6LFu8IPIWSbDQKqLMG4zA=";
    fetcherVersion = 3;
  };

  nativeBuildInputs = [ nodejs pnpm-build pnpmConfigHook jq ];

  buildPhase = ''
    runHook preBuild
    pnpm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    test -f dist/index.jsx -a -f dist/index.d.ts -a -f dist/styles.css
    mkdir -p "$out"
    cp -r dist "$out/dist"
    cp LICENSE "$out/LICENSE"
    jq 'del(.devDependencies, .scripts)' package.json > "$out/package.json"
    runHook postInstall
  '';

  dontFixup = true;
})
