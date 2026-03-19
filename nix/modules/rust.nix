{ inputs, ... }:
{
  imports = [
    inputs.rust-flake.flakeModules.default
    inputs.rust-flake.flakeModules.nixpkgs
  ];
  perSystem = { config, self', pkgs, lib, ... }:
    let
      craneLib = config.rust-project.crane-lib;

      # Source with non-Rust files preserved for Trunk (html, css, js, tailwind config).
      unfilteredRoot = ../..;
      src = lib.fileset.toSource {
        root = unfilteredRoot;
        fileset = lib.fileset.unions [
          (craneLib.fileset.commonCargoSources unfilteredRoot)
          (lib.fileset.fileFilter
            (file: lib.any file.hasExt [ "html" "css" "js" "svg" ])
            unfilteredRoot)
        ];
      };

      # Trunk builds the Leptos CSR app: compiles Rust to WASM, runs
      # wasm-bindgen + wasm-opt, processes Tailwind CSS, and hash-renames
      # all assets with cross-reference rewriting. One derivation replaces
      # manual wasm-bindgen + wasm-opt + tailwindcss + hash-rename pipeline.
      clientDist = craneLib.buildTrunkPackage {
        pname = "kolu-client";
        version = "0.1.0";
        inherit src;
        cargoExtraArgs = "-p kolu-client";
        wasm-bindgen-cli = pkgs.wasm-bindgen-cli;
        nativeBuildInputs = [ pkgs.tailwindcss ];
        # Trunk must run from client/ to find Cargo.toml and index.html.
        # Move workspace root up one level so Trunk sees the workspace.
        postUnpack = ''
          cd $sourceRoot/client
          sourceRoot="."
        '';
      };
    in
    {
      rust-project.crateNixFile = "crate.nix";

      packages.client = clientDist;

      # Wrapper script: starts the server with client dist embedded.
      packages.default = pkgs.writeShellApplication {
        name = "kolu";
        text = ''
          export KOLU_CLIENT_DIST="${clientDist}"
          exec ${self'.packages.kolu-server}/bin/kolu-server "$@"
        '';
      };
    };
}
