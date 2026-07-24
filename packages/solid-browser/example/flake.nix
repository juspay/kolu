# Nix package for the @kolu/solid-browser example docsite.
#
# The example reuses Kolu's workspace source and pnpm closure without entering
# the runnable Kolu flake's package set.
{
  outputs = { ... }:
    let
      platform = import ../../../nix/each-system.nix;
    in
    {
      packages = platform.withPkgs (pkgs:
        let
          workspace = import ../../../nix/workspace.nix { inherit pkgs; };
        in
        import ./docsite/default.nix {
          inherit pkgs;
          inherit (workspace) src;
          pnpmDeps = workspace.pnpmDeps;
        });
    };
}
