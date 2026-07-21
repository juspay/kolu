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
  # public/{favicon,kaval-logo,padi-logo}.svg as symlinks into packages/ (one SVG
  # each on disk, no duplicated bytes) — but those dangle once copied into the
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
        ./test
      ];
    }} $out
    chmod -R u+w $out
    rm -f $out/public/favicon.svg
    cp ${../packages/client/favicon.svg} $out/public/favicon.svg
    rm -f $out/public/kaval-logo.svg
    cp ${../packages/kaval/logo.svg} $out/public/kaval-logo.svg
    rm -f $out/public/padi-logo.svg
    cp ${../packages/padi/logo.svg} $out/public/padi-logo.svg
    cp ${../packages/server/package.json} $out/kolu-server-package.json
    cp ${../scripts/fence-langs.mjs} $out/fence-langs.mjs
  ''
}:
let
  # Website displays Kolu's app version, whose single source of truth is
  # packages/server/package.json (same as the root derivation). Thread this
  # through Nix so the sandbox never needs to reach outside `src`.
  version = (pkgs.lib.importJSON ../packages/server/package.json).version;

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
    hash = "sha256-x1NKPI1+K37XA10aiJ5flq7TSNQnM4ifdvZ/Y0slDiU=";
    fetcherVersion = 3;
  };

  # The docs' <Snippet> component (src/components/docs/Snippet.astro) embeds real,
  # workspace-typechecked example sources — packages/surface/example/{snippets,
  # fleet-top} — by reading the files at build time as `../packages/…` relative to
  # the website root, exactly as the working tree has them (website/ and packages/
  # are siblings under the repo root). This hermetic sandbox's build root is the
  # website src ALONE, so those files are absent and `astro build` fails loudly on
  # the first <Snippet>. Vendor a clean copy (no node_modules/dist) and place it
  # as the website root's sibling in the build tree (preBuild below), so the same
  # relative read resolves — the store copy keeps CI faithful to the working tree.
  exampleSnippetSrc = pkgs.lib.cleanSourceWith {
    name = "surface-example-snippet-src";
    src = ../packages/surface/example;
    filter = path: _type:
      let s = toString path; in
      !(pkgs.lib.hasInfix "/node_modules/" s)
      && !(pkgs.lib.hasSuffix "/node_modules" s)
      && !(pkgs.lib.hasInfix "/dist/" s)
      && !(pkgs.lib.hasSuffix "/dist" s);
  };

  default = pkgs.stdenv.mkDerivation {
    pname = "kolu-website";
    inherit version;
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

    # Unit pins for the shiki eager-langs preload (test/*.test.mjs): the
    # derived `langs` wiring, grammar-engaged rendering, and the fail-fast
    # guard — CI-gated here via ci::nix, no separate lane needed.
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      node --test test/*.test.mjs
      runHook postCheck
    '';

    # Place the vendored example sources as the website root's sibling so
    # <Snippet>'s `../packages/…` reads resolve in the sandbox (see
    # exampleSnippetSrc). Runs before `pnpm build`.
    preBuild = ''
      mkdir -p ../packages/surface
      cp -r ${exampleSnippetSrc} ../packages/surface/example
      chmod -R u+w ../packages
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

  # The type gate for website/ (juspay/kolu#1049): `astro sync && tsc --noEmit`.
  # `pnpm build` (astro build) transpiles TS without typechecking, exactly like
  # the main app, so a type error in the site's TS/TSX would otherwise deploy
  # green. The root flake exposes this as checks.${system}.website-typecheck.
  typecheck = import ../nix/pnpm-typecheck.nix {
    inherit pkgs src pnpmDeps version;
    pname = "kolu-website-typecheck";
  };
in
{
  inherit default pnpmDeps typecheck;
}
