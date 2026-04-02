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
          render-mermaid = pkgs.writeShellApplication {
            name = "render-mermaid";
            runtimeInputs = [ pkgs.yq-go pkgs.jq pkgs.gawk pkgs.git ];
            text = builtins.readFile ./render-mermaid.sh;
          };
        in
        {
          default = wrapper;
          inherit lib render-mermaid;
        });
    };
}
