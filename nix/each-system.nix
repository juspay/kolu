let
  # No x86_64-darwin: agent-distro (the coding agents every kolu terminal can
  # get, packages/agent-distro/default.nix) does not build for Intel Macs.
  systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
  mapSystems = f:
    builtins.listToAttrs (map
      (system: {
        name = system;
        value = f system;
      })
      systems);
in
{
  inherit mapSystems;
  withPkgs = f:
    mapSystems
      (system: f (import ./nixpkgs.nix { inherit system; }));
}
