{ pkgs ? import ../nix/nixpkgs.nix { }
, src ? let
    outOfTreePublicAssets = {
      "favicon.svg" = "${../packages/client/favicon.svg}";
      "kaval-logo.svg" = "${../packages/kaval/logo.svg}";
      "padi-logo.svg" = "${../packages/padi/logo.svg}";
    };
    resolveOutOfTreePublicAssets = pkgs.lib.concatStrings (
      pkgs.lib.mapAttrsToList
        (name: storePath: ''
          rm -f $out/public/${name}
          cp ${storePath} $out/public/${name}
        '')
        outOfTreePublicAssets
    );
  in
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
    ${resolveOutOfTreePublicAssets}
    cp ${../packages/server/package.json} $out/kolu-server-package.json
    cp ${../scripts/fence-langs.mjs} $out/fence-langs.mjs
  ''
}:
let
  version = (pkgs.lib.importJSON ../packages/server/package.json).version;

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu-website";
    inherit version src;
    pnpm = pkgs.pnpm-build;
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
    hash = "sha256-ysCCK+aJ31nXgTb/iN6vAfSx5tBLuRDWFMNqCl8w53o=";
    fetcherVersion = 3;
  };

  snippetRoot =
    let
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
    in
    pkgs.runCommand "kolu-website-snippet-root" { } ''
      mkdir -p $out/packages/surface
      cp -r ${exampleSnippetSrc} $out/packages/surface/example
    '';

  default = pkgs.stdenv.mkDerivation {
    pname = "kolu-website";
    inherit version;
    inherit src pnpmDeps;

    nativeBuildInputs = [
      pkgs.nodejs
      pkgs.pnpm-build
      pkgs.pnpmConfigHook
    ];

    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      pnpm build
      runHook postBuild
    '';

    doCheck = true;
    checkPhase = ''
      runHook preCheck
      node --test test/*.test.mjs
      runHook postCheck
    '';

    KOLU_SNIPPET_ROOT = snippetRoot;

    installPhase = ''
      runHook preInstall
      cp -r dist $out
      cp -r ${../docs/atlas/dist} $out/atlas
      runHook postInstall
    '';
  };

  # The type gate for website/ (juspay/kolu#1049): `astro sync && tsc --noEmit`.
  # `pnpm build` (astro build) transpiles TS without typechecking, exactly like
  # the main app, so a type error in the site's TS/TSX would otherwise deploy
  # green. website/flake.nix exposes this as checks.${system}.typecheck.
  typecheck = import ../nix/pnpm-typecheck.nix {
    inherit pkgs src pnpmDeps version;
    pname = "kolu-website-typecheck";
  };

  # lychee builds its HTTP client at startup even with --offline, and that
  # client refuses to start without CA roots, so the sandbox gets cacert.
  linkcheck = pkgs.runCommand "kolu-website-linkcheck"
    {
      nativeBuildInputs = [ pkgs.lychee ];
      SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
    } ''
    bash ${./linkcheck.sh} ${default}
    touch $out
  '';
in
{
  inherit default pnpmDeps typecheck linkcheck;
}
