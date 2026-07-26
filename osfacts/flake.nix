# osfacts's own flake, so it can be run — and later moved — on its own:
#
#     nix run ./osfacts            # this flake
#     nix run .#osfacts            # the same binary, from the root flake
#
# ZERO inputs. It reuses the repository's npins-backed nixpkgs through
# nix/each-system.nix. The build itself lives in ./default.nix; both this
# flake and the root flake import that one definition, so they can never
# build two osfacts. The extraction gap (when this directory becomes its
# own repo) is: give this flake its own nixpkgs pin and drop the
# relative import — the package definition does not change.
{
  outputs = { ... }:
    let
      platform = import ../nix/each-system.nix;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          osfacts = import ./default.nix { inherit pkgs; };
        in
        { inherit osfacts; default = osfacts; });
    };
}
