# Nix packages shipped by the @kolu/surface examples.
#
# The examples depend on Kolu's workspace source and pnpm closure, but the
# runnable Kolu flake does not depend on the examples.
{
  outputs = { ... }:
    let
      platform = import ../../../nix/each-system.nix;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          workspace = import ../../../nix/workspace.nix { inherit pkgs; };
          shared = {
            inherit pkgs;
            inherit (workspace) src;
            pnpmDeps = workspace.pnpmDeps;
          };
        in
        import ./remote-process-monitor/default.nix shared
        // import ./mini-ci/default.nix shared
        // import ./fleet-top/default.nix shared);
    };
}
