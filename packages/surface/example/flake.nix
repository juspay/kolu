# Nix packages shipped by the @kolu/surface examples.
#
# The examples depend on Kolu's workspace source and pnpm closure, but the
# runnable Kolu flake does not depend on the examples.
{
  # The caches an example agent's binaries may be fetched from. Load-bearing,
  # not decoration: `agent-source` below derives `binary-cache.json` from this
  # block, and `@kolu/surface-remote` refuses to provision an agent source
  # without one. Examples ride Kolu's own cache — they are built from this
  # repo's workspace.
  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
  };

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

          # The flake-shaped source the example binders bake as
          # SURFACE_AGENT_FLAKE_REF: THIS flake's source plus the binary-cache
          # sidecar every dial reads. Assembled by the SAME shared recipe
          # `mkProvenAgentSource` uses for Kolu's own agents, so the layout has
          # one implementation and the two can't drift. (The examples skip the
          # prove half — they have no agent attrs to force from a fileset.)
          # Baking the raw source instead would resolve agents fine and then
          # fail at dial time on a missing sidecar.
          agent-source = import ../../surface-daemon/nix/agent-source-tree.nix
            { inherit (pkgs) lib; }
            {
              inherit pkgs;
              name = "surface-example-agent-source";
              src = self.outPath;
              flakeNix = ./flake.nix;
              label = "surface examples";
            };

          remote = shared // {
            agentFlakeRef = "${agent-source}";
            agentFlakeRefEnv =
              (builtins.fromJSON
                (builtins.readFile ../../surface-remote/agent-env.json)).flakeRef;
          };
        in
        { inherit agent-source; }
        // import ./remote-process-monitor/default.nix remote
        // import ./mini-ci/default.nix remote
        // import ./fleet-top/default.nix shared);
    };
}
