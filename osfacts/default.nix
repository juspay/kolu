# The osfacts binary: one definition, two entry points.
#
#   nix run ./osfacts              # this directory's flake
#   nix run .#osfacts              # the same derivation, from the root flake
#
# Both import this file, so they can never build two osfacts. Toolchain and
# nixpkgs come from the repo's npins pin (via nix/nixpkgs.nix) — no flake
# inputs, no second rustc.
#
# checkPhase runs the hermetic gate (lane 1) under cargo-nextest — process-
# per-test isolation and per-test timeouts. Lane 2 (live-host oracle) is
# outside this phase: it needs a real host, not the build sandbox. It still
# joins the full `/ci` run DAG (`ci::osfacts-live`, after the hermetic build)
# but never branch protection. See scripts/live-oracle.sh.
{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "osfacts";
  version = "0.1.0";

  src = pkgs.lib.fileset.toSource {
    root = ./.;
    fileset = pkgs.lib.fileset.unions [
      ./Cargo.toml
      ./Cargo.lock
      ./.config
      # The facet vocabulary contract file — `tests/v2_contract.rs` pins it to
      # the `Facet` enum, and the TypeScript client pins its unions to it.
      ./facets.json
      ./src
      ./tests
      ./features
      ./scripts
    ];
  };

  cargoLock.lockFile = ./Cargo.lock;

  # cargo-nextest: process-per-test + timeouts. No util-linux — hermetic
  # isolation is scoped self-referential asserts, not an unshare netns.
  nativeCheckInputs = [ pkgs.cargo-nextest ];

  checkPhase = ''
    runHook preCheck
    export NEXTEST_PROFILE=ci
    # Exclude the live-oracle harness (needs OSFACTS_LIVE=1 + a real host).
    cargo nextest run --profile ci -E 'not binary(live_oracle)'
    runHook postCheck
  '';

  meta = {
    description = "Scoped, honest OS process and socket facts";
    mainProgram = "osfacts";
  };
}
