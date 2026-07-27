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
          # SURFACE_AGENT_FLAKE_REF. It is THIS flake's source plus the
          # `binary-cache.json` sidecar every dial reads (the same file
          # `mkProvenAgentSource` writes for Kolu's own agents, from the same
          # shared recipe — one implementation, so the two can't drift). Baking
          # the raw source instead would resolve agents fine and then fail at
          # dial time on a missing sidecar.
          agent-source = pkgs.runCommand "surface-example-agent-source" { } ''
            mkdir -p "$out"
            cp -a ${self.outPath}/. "$out/"
            chmod -R u+w "$out"
            printf '%s' ${
              pkgs.lib.escapeShellArg (builtins.toJSON (
                import ../../surface-daemon/nix/binary-cache.nix
                  { inherit (pkgs) lib; }
                  { flakeNix = ./flake.nix; label = "surface examples"; }
              ))
            } > "$out/binary-cache.json"
          '';

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
