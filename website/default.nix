# Kolu website — Astro static site build.
#
# Output layout: $out/  is the dist/ directory produced by `pnpm build`,
# ready to be served as a static site (GitHub Pages, Cloudflare Pages, etc.).
{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./pnpm-lock.yaml
      ./tsconfig.json
      ./astro.config.mjs
      ./src
      ./public
    ];
  };

  # fetchPnpmDeps hash is platform-independent. It is regenerated when
  # pnpm-lock.yaml changes — run `nix build .#pnpmDeps` and replace the hash
  # with the "got:" value that Nix prints on mismatch. Same workflow as the
  # root repo's kolu derivation.
  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu-website";
    version = "0.1.0";
    inherit src;
    hash = "sha256-iNCSF/rzOZyO9bjbdDZOrJ79f0d7fMODdqeKssefu8s=";
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

    # Astro build is pure JS — skip the fixupPhase (strip/patchShebangs)
    # which would traverse node_modules for no benefit.
    dontFixup = true;

    # Pass --base at build time so the produced static site is rooted at the
    # deploy path (e.g. GitHub Pages project site → /kolu). Overridable via
    # `nix build --argstr base /something`.
    buildPhase = ''
      runHook preBuild
      pnpm build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -r dist $out
      runHook postInstall
    '';
  };
in
{
  inherit default pnpmDeps;
}
