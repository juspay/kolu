# Kolu website — Astro static site build.
#
# Output: $out/ is the dist/ directory produced by `pnpm build`, ready to
# be served as a static site (GitHub Pages, Cloudflare Pages, etc.).
#
# Imported from the root flake.nix and exposed as packages.${system}.website.
# Reuses the root's npins-pinned nixpkgs (via ../nix/nixpkgs.nix) so there's
# no duplicate pin to keep in sync. `src` is optional — when omitted, a
# self-contained fileset is built from ./; the root flake passes a
# synthesized src that resolves the favicon symlink.
{ pkgs ? import ../nix/nixpkgs.nix { }
, src ? pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./package.json
      ./pnpm-lock.yaml
      ./tsconfig.json
      ./astro.config.mjs
      ./src
      ./public
    ];
  }
}:
let
  # fetchPnpmDeps hash is platform-independent. Regenerate when pnpm-lock.yaml
  # changes — `just ci::pnpm-hash-fresh` checks this alongside the root's
  # pnpmDeps. On mismatch, Nix prints the expected hash; paste it back here.
  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu-website";
    version = "0.1.0";
    inherit src;
    hash = "sha256-ZKnbWoE2DlCKnjiAXkThYIrEOXGsZKYgulz12dCvTkQ=";
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

    # Astro build is pure JS — skip the fixupPhase (strip/patchShebangs) which
    # would traverse node_modules for no benefit.
    dontFixup = true;

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
