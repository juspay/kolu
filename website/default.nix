# Kolu website — Astro static site build.
#
# Output: $out/ is the dist/ directory produced by `pnpm build`, ready to
# be served as a static site (GitHub Pages, Cloudflare Pages, etc.).
#
# Imported from the root flake.nix and exposed as packages.${system}.website.
# Reuses the root's npins-pinned nixpkgs (via ../nix/nixpkgs.nix) so there's
# no duplicate pin to keep in sync. `src` is optional and self-contained — it
# resolves the public/ asset symlinks (see below), so the root flake just does
# `import ./website { inherit pkgs; }` with no synthesis of its own.
{ pkgs ? import ../nix/nixpkgs.nix { }
, src ? # Self-contained website source for the Nix sandbox. The working tree keeps
  # public/{favicon,kaval-logo}.svg as symlinks into packages/ (one SVG each
  # on disk, no duplicated bytes) — but those dangle once copied into the
  # store, so resolve them to real bytes here. Astro/Vite then sees a
  # complete tree. Add a line per new out-of-tree public/ asset.
  pkgs.runCommand "kolu-website-src" { } ''
    cp -r ${pkgs.lib.fileset.toSource {
      root = ./.;
      fileset = pkgs.lib.fileset.unions [
        ./package.json
        ./pnpm-lock.yaml
        ./tsconfig.json
        ./astro.config.mjs
        ./src
        ./public
      ];
    }} $out
    chmod -R u+w $out
    rm -f $out/public/favicon.svg
    cp ${../packages/client/favicon.svg} $out/public/favicon.svg
    rm -f $out/public/kaval-logo.svg
    cp ${../packages/kaval/logo.svg} $out/public/kaval-logo.svg
  ''
}:
let
  # Single source for the website version — its own package.json (no literal to
  # drift). Threaded into fetchPnpmDeps and the typecheck derivation below.
  version = (pkgs.lib.importJSON ./package.json).version;

  # fetchPnpmDeps hash is platform-independent. Regenerate when pnpm-lock.yaml
  # changes — `just ci::pnpm-hash-fresh` checks this alongside the root's
  # pnpmDeps. On mismatch, Nix prints the expected hash; paste it back here.
  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu-website";
    inherit version src;
    # Determinism guard (juspay/kolu#1097). The fetcher runs `pnpm install
    # --force`, which pulls every platform's optional binaries (so Darwin and
    # Linux share one hash) — but `--force` treats those cross-platform
    # packages as *best-effort*: a slow or timed-out download of a heavy blob
    # (@img/sharp's libvips ~8MB each, canvaskit-wasm) is silently dropped, so
    # a network-pressured box ends up with fewer packages and a different store
    # hash. That flaked `ci::pnpm-hash-fresh@x86_64-linux` at random, ~1/3 of
    # linux runs. Declaring the full os/cpu/libc matrix in supportedArchitectures
    # makes those binaries *required*: pnpm must fetch all of them (erroring or
    # retrying, never silently skipping) under --frozen-lockfile, so every box
    # converges on the same store. We inject it via prePnpmInstall (here, in the
    # Nix sandbox) rather than committing it to package.json so a local
    # `pnpm install` in website/ still fetches only the host's binaries.
    # The matrix is a superset of every platform in pnpm-lock.yaml, so the
    # fetched set — and this hash — is identical to the pre-fix `--force` set.
    prePnpmInstall = ''
      jq '.pnpm.supportedArchitectures = {
        os: ["linux", "darwin", "win32", "freebsd", "openbsd", "netbsd", "sunos", "android", "openharmony", "aix"],
        cpu: ["x64", "ia32", "arm64", "arm", "ppc64", "ppc", "s390x", "riscv64", "loong64", "mips64el", "wasm32"],
        libc: ["glibc", "musl"]
      }' package.json | sponge package.json
    '';
    hash = "sha256-4d3RdSXUlFXwbeDGQSJ3Mc2F9skH/77ovN0u1GjamaM=";
    fetcherVersion = 3;
  };

  default = pkgs.stdenv.mkDerivation {
    pname = "kolu-website";
    version = "0.1.0";
    inherit src pnpmDeps;

    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.pnpm
      pkgs.pnpmConfigHook
    ];

    # Astro build is pure JS — skip the fixupPhase (strip/patchShebangs) which
    # would traverse node_modules for no benefit.
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      pnpm build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -r dist $out
      # Fold the committed Atlas dist in at /atlas/. The notes are
      # self-contained HTML with inlined CSS and relative cross-links (Astro
      # `format: "file"`), so they need no Astro/Vite processing — copy them in
      # verbatim. `kolu.dev/atlas/` serves docs/atlas/dist/index.html.
      cp -r ${../docs/atlas/dist} $out/atlas
      runHook postInstall
    '';
  };

  # The type gate for website/ (juspay/kolu#1049): `astro check`. `pnpm build`
  # (astro build) transpiles without typechecking, exactly like the main app,
  # so a type error in the site would otherwise deploy green. The root flake
  # exposes this as checks.${system}.website-typecheck.
  typecheck = import ../nix/pnpm-typecheck.nix {
    inherit pkgs src pnpmDeps version;
    pname = "kolu-website-typecheck";
  };
in
{
  inherit default pnpmDeps typecheck;
}
