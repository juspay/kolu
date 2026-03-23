{ inputs, ... }:
{
  perSystem = { config, self', pkgs, lib, ... }:
    let
      nodejs = pkgs.nodejs;
      pnpm = pkgs.pnpm;
      ghosttyThemes = pkgs.callPackage ../ghostty-themes { };

      # Build ghostty-web from git (latest) as a fixed-output derivation.
      # The upstream flake's build can't run in Nix sandbox (bun install
      # needs network), so we use a FOD which allows network access.
      # fetchGit with submodules=true fetches the ghostty zig submodule.
      ghosttyWebSrc = builtins.fetchGit {
        url = "https://github.com/coder/ghostty-web.git";
        rev = inputs.ghostty-web.rev;
        submodules = true;
      };
      zig = inputs.ghostty-web.inputs.zig-overlay.packages.${pkgs.system}."0.15.2";
      ghosttyWebPkg = pkgs.stdenv.mkDerivation {
        pname = "ghostty-web";
        version = "0.0.0-git+${inputs.ghostty-web.shortRev or "latest"}";
        src = ghosttyWebSrc;

        nativeBuildInputs = [ pkgs.bun pkgs.nodejs_22 pkgs.cacert zig pkgs.git ];

        # FOD: allows network access for bun install; output verified by hash.
        outputHashMode = "recursive";
        outputHashAlgo = "sha256";
        outputHash = "sha256-agJluTy6Bc90ZzkR2DJzMLiqbnd4hmfGUoQH7VGKDbc=";

        buildPhase = ''
          export HOME=$TMPDIR
          export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
          export GIT_AUTHOR_NAME="nix" GIT_COMMITTER_NAME="nix"
          export GIT_AUTHOR_EMAIL="nix@build" GIT_COMMITTER_EMAIL="nix@build"

          bun install --frozen-lockfile

          # The build script uses git apply on the ghostty submodule,
          # which requires a git repo. Set up minimal repos.
          git -C ghostty init
          git -C ghostty add -A
          git -C ghostty commit -m init
          git init
          git add -A
          git commit -m init

          # Fix shebang in build script (uses /bin/bash)
          patchShebangs scripts/

          bun run build
        '';

        installPhase = ''
          mkdir -p $out
          cp -r dist/* $out/
          cp package.json $out/
        '';
      };

      src = lib.fileset.toSource {
        root = ../..;
        fileset = lib.fileset.unions [
          ../../package.json
          ../../pnpm-workspace.yaml
          ../../pnpm-lock.yaml
          ../../tsconfig.base.json
          ../../common
          ../../server
          ../../client
        ];
      };

      pnpmDeps = pkgs.fetchPnpmDeps {
        pname = "kolu";
        version = "0.1.0";
        inherit src;
        hash = "sha256-JsMdjOmgkaW10OfUNelRXFpPtQkhKF/1MONQqQjgbN4=";
        fetcherVersion = 3;
      };

      # Single derivation: installs deps, builds client, bundles server
      kolu = pkgs.stdenv.mkDerivation {
        pname = "kolu";
        version = "0.1.0";
        inherit src;

        nativeBuildInputs = [
          nodejs
          pnpm
          pkgs.pnpmConfigHook
          pkgs.python3
          pkgs.node-gyp
          pkgs.pkg-config
        ];

        inherit pnpmDeps;

        # Point node-gyp at Nix's Node headers (avoids download in sandbox).
        # NIX_NODEJS_BUILDNPMPACKAGE works around pnpmConfigHook not setting
        # it, which breaks node-gyp's distutils resolution (nixpkgs#385035).
        env.npm_config_nodedir = nodejs;
        env.NIX_NODEJS_BUILDNPMPACKAGE = "1";
        env.KOLU_THEMES_JSON = "${ghosttyThemes}/themes.json";
        env.GHOSTTY_WEB_PKG = "${ghosttyWebPkg}";

        buildPhase = ''
          runHook preBuild

          # Build node-pty native addon from source. The npm tarball ships
          # prebuilds for darwin/win only — linux needs compilation.
          # pnpm rebuild doesn't reliably invoke node-gyp, so we call it
          # directly in the pnpm virtual store.
          pushd node_modules/.pnpm/node-pty@*/node_modules/node-pty
          node-gyp rebuild
          popd

          pnpm --filter kolu-client build
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall

          # Copy entire workspace (preserves pnpm symlink structure)
          cp -r . $out

          # Remove build artifacts that aren't needed
          rm -rf $out/client/src $out/client/node_modules

          # Fix spawn-helper permissions (node-pty prebuild)
          chmod +x $out/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true

          runHook postInstall
        '';
      };
    in
    {
      packages = {
        inherit kolu ghosttyThemes ghosttyWebPkg;

        default = pkgs.writeShellApplication {
          name = "kolu";
          runtimeInputs = [ nodejs pkgs.tsx ];
          text = ''
            export KOLU_CLIENT_DIST="${kolu}/client/dist"
            exec tsx "${kolu}/server/src/index.ts" "$@"
          '';
        };
      };
    };
}
