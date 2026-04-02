{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system: {
          name = system;
          value = f nixpkgs.legacyPackages.${system};
        })
        systems);
    in
    {
      packages = eachSystem (pkgs:
        let
          lib = pkgs.callPackage ./default.nix { };
          wrapper = pkgs.writeShellApplication {
            name = "padi";
            runtimeInputs = [ pkgs.nodejs pkgs.tsx ];
            text = ''
              exec tsx "${lib}/src/index.ts" "$@"
            '';
          };
        in
        {
          default = wrapper;
          lib = lib;
        });
    };
}
