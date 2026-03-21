{ inputs, ... }:
{
  perSystem = { config, self', pkgs, lib, ... }:
    let
      nodejs = pkgs.nodejs;
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

      # Single build that produces client dist + server bundle
      kolu = pkgs.buildNpmPackage {
        pname = "kolu";
        version = "0.1.0";
        inherit src;
        npmDepsHash = lib.fakeHash;
        nativeBuildInputs = with pkgs; [ python3 ];
        makeCacheWritable = true;
        NODE_OPTIONS = "--max-old-space-size=4096";

        buildPhase = ''
          runHook preBuild
          npx pnpm --filter kolu-client build
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p $out/{server,common,client-dist}
          cp -r node_modules $out/
          cp -r common/src $out/common/
          cp package.json $out/
          cp -r server/src $out/server/
          cp -r client/dist/* $out/client-dist/
          runHook postInstall
        '';
      };
    in
    {
      packages = {
        inherit kolu;
        default = pkgs.writeShellApplication {
          name = "kolu";
          runtimeInputs = [ nodejs pkgs.tsx ];
          text = ''
            export KOLU_CLIENT_DIST="${kolu}/client-dist"
            export NODE_PATH="${kolu}/node_modules"
            exec node --import tsx "${kolu}/server/src/index.ts" "$@"
          '';
        };
      };
    };
}
