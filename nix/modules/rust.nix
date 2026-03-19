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

      # Fetch ghostty-web npm tarball — no npm needed at Nix build time.
      ghosttyWebTgz = pkgs.fetchurl {
        url = "https://registry.npmjs.org/ghostty-web/-/ghostty-web-0.4.0.tgz";
        hash = "sha256-kL9HO2x/Q6teUu6Y2CleBPscawe5KOl5VInfHoy4gC4=";
      };
      ghosttyWeb = pkgs.stdenv.mkDerivation {
        pname = "ghostty-web";
        version = "0.4.0";
        src = ghosttyWebTgz;
        phases = [ "unpackPhase" "installPhase" ];
        unpackPhase = "tar xzf $src";
        installPhase = "cp -r package $out";
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
        # Inject ghostty-web into node_modules/ so Trunk's copy-file directives resolve.
        postUnpack = ''
          cd $sourceRoot/client
          sourceRoot="."
          mkdir -p node_modules/ghostty-web
          cp -r ${ghosttyWeb}/* node_modules/ghostty-web/
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
