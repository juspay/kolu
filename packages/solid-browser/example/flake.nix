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
