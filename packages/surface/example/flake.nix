# Nix packages shipped by the @kolu/surface examples.
#
# The examples depend on Kolu's workspace source and pnpm closure, but the
# runnable Kolu flake does not depend on the examples.
{
  outputs = { self, ... }:
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
          remote = shared // {
            agentFlakeRef = self.outPath;
            agentFlakeRefEnv =
              (builtins.fromJSON
                (builtins.readFile ../../surface-remote/agent-env.json)).flakeRef;
          };
        in
        import ./remote-process-monitor/default.nix remote
        // import ./mini-ci/default.nix remote
        // import ./fleet-top/default.nix shared);
    };
}
