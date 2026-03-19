{ inputs, ... }:
{
  imports = [
    inputs.rust-flake.flakeModules.default
    inputs.rust-flake.flakeModules.nixpkgs
  ];
  perSystem = { config, self', pkgs, lib, ... }:
    let
      craneLib = config.rust-project.crane-lib;
      src = lib.cleanSource ../..;

      # Step 1: Compile kolu-client to WASM, then post-process.
      #
      # crane builds the Rust crate targeting wasm32-unknown-unknown.
      # We override installPhaseCommand to run wasm-bindgen (generates JS
      # glue + _bg.wasm) and wasm-opt (shrinks the binary). The default
      # crane install phase doesn't know about these tools.
      clientWasm = craneLib.buildPackage {
        pname = "kolu-client";
        version = "0.1.0";
        inherit src;
        cargoExtraArgs = "-p kolu-client --target wasm32-unknown-unknown";
        doCheck = false; # no tests for WASM target
        CARGO_BUILD_TARGET = "wasm32-unknown-unknown";
        nativeBuildInputs = [ pkgs.wasm-bindgen-cli pkgs.binaryen ];
        installPhaseCommand = ''
          mkdir -p $out/dist
          # Generate JS bindings + optimized .wasm from cargo's raw output
          wasm-bindgen \
            target/wasm32-unknown-unknown/release/kolu-client.wasm \
            --out-dir $out/dist \
            --target web \
            --no-typescript
          # Shrink WASM binary; || true because wasm-opt can fail on some platforms
          wasm-opt -Os $out/dist/kolu-client_bg.wasm -o $out/dist/kolu-client_bg.wasm || true
        '';
      };

      # Step 2: Assemble the client dist directory.
      #
      # Combines wasm-bindgen output (JS + WASM) with static assets
      # (CSS) and a generated index.html that bootstraps the WASM module.
      # Trunk handles this in dev mode; this is the production equivalent.
      # Step 2b: Hash-rename assets for cache busting.
      #
      # Renames JS, WASM, and CSS files to include a content hash,
      # then rewrites index.html references to match.
      clientDist = pkgs.stdenv.mkDerivation {
        pname = "kolu-client-dist";
        version = "0.1.0";
        src = ../../client;
        nativeBuildInputs = [ pkgs.coreutils pkgs.tailwindcss ];
        phases = [ "unpackPhase" "installPhase" ];
        installPhase = ''
          mkdir -p $out
          cp -r ${clientWasm}/dist/* $out/
          cp nix-index.html $out/index.html

          # Generate minified Tailwind CSS by scanning Rust source for class names.
          # unpackPhase cd's into the client/ source root.
          tailwindcss -i ./input.css -o $out/tailwind.css --minify

          # Hash-rename each asset and rewrite references in index.html
          for f in $out/*.{js,wasm,css}; do
            [ -f "$f" ] || continue
            base=$(basename "$f")
            ext="''${base##*.}"
            name="''${base%.*}"
            hash=$(sha256sum "$f" | cut -c1-8)
            newname="''${name}-''${hash}.''${ext}"
            mv "$f" "$out/$newname"
            substituteInPlace $out/index.html --replace-warn "$base" "$newname"
          done
        '';
      };
    in
    {
      # Each crate has a crate.nix controlling what rust-flake auto-wires.
      # server: builds + clippy. client/common: nothing (built separately above).
      rust-project.crateNixFile = "crate.nix";

      packages.client = clientDist;

      # Step 3: Wrapper script that starts the server with client dist embedded.
      # `nix run` gives you a single command that serves everything.
      packages.default = pkgs.writeShellApplication {
        name = "kolu";
        text = ''
          export KOLU_CLIENT_DIST="${clientDist}"
          exec ${self'.packages.kolu-server}/bin/kolu-server "$@"
        '';
      };
    };
}
