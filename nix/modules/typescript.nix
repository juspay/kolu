{ inputs, ... }:
{
  perSystem = { config, self', pkgs, lib, ... }:
    let
      nodejs = pkgs.nodejs;
      pnpm = pkgs.pnpm;
      ghosttyThemes = pkgs.callPackage ../ghostty-themes { };
      fonts = pkgs.callPackage ../fonts { };

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
        hash = "sha256-Jt8UbXb8eDx6C8tXMUy2j9I9ZTLCAnHhxFHjwZ9ROdw=";
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
        env.KOLU_FONTS_DIR = "${fonts}";
        env.KOLU_COMMIT_HASH = inputs.self.shortRev or inputs.self.dirtyShortRev or "dev";

        buildPhase = ''
          runHook preBuild

          # Build node-pty native addon from source. The npm tarball ships
          # prebuilds for darwin/win only — linux needs compilation.
          # pnpm rebuild doesn't reliably invoke node-gyp, so we call it
          # directly in the pnpm virtual store.
          pushd node_modules/.pnpm/node-pty@*/node_modules/node-pty
          node-gyp rebuild
          popd

          ln -sfn $KOLU_FONTS_DIR client/public/fonts
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
        inherit kolu ghosttyThemes fonts;

        default = pkgs.writeShellApplication {
          name = "kolu";
          runtimeInputs = [ nodejs pkgs.tsx pkgs.git ];
          text = ''
            export KOLU_CLIENT_DIST="${kolu}/client/dist"
            export KOLU_CLIPBOARD_SHIM_DIR="${config.packages.clipboard-shims}/bin"
            exec tsx "${kolu}/server/src/index.ts" "$@"
          '';
        };
      };
    };
}
