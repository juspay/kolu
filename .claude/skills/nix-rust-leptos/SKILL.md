---
name: nix-rust-leptos
description: Conventions for building Leptos CSR apps with Nix (crane + Trunk).
user-invocable: false
---

# Leptos CSR + Nix Build

## Use Trunk for production builds

Don't manually run wasm-bindgen + wasm-opt + hash-rename. Use `craneLib.buildTrunkPackage` which delegates to Trunk — it handles WASM compilation, wasm-bindgen, wasm-opt, Tailwind CSS, asset hashing, SRI, and cross-reference rewriting automatically.

## Workspace layout

Trunk expects to run from the crate directory containing `index.html` and `Cargo.toml`. In a workspace, use `postUnpack` to cd into the client crate:

```nix
clientDist = craneLib.buildTrunkPackage {
  pname = "my-client";
  inherit src;
  cargoExtraArgs = "-p my-client";
  wasm-bindgen-cli = pkgs.wasm-bindgen-cli;
  nativeBuildInputs = [ pkgs.tailwindcss ]; # not auto-included
  postUnpack = ''
    cd $sourceRoot/client
    sourceRoot="."
  '';
};
```

## Source filtering

Crane's default source filter strips non-Rust files. Preserve HTML, CSS, and JS for Trunk:

```nix
src = lib.fileset.toSource {
  root = ./.;
  fileset = lib.fileset.unions [
    (craneLib.fileset.commonCargoSources ./.)
    (lib.fileset.fileFilter (f: lib.any f.hasExt [ "html" "css" "js" ]) ./.)
  ];
};
```

## Version matching

`wasm-bindgen-cli` in nixpkgs must match `wasm-bindgen` in `Cargo.lock` exactly. Check with `nix eval --raw 'nixpkgs#wasm-bindgen-cli.version'`.

## Tailwind CSS

Use `<link data-trunk rel="tailwind-css" href="input.css" />` in index.html. Trunk processes it automatically. Add `pkgs.tailwindcss` to `nativeBuildInputs` (not auto-included by crane).