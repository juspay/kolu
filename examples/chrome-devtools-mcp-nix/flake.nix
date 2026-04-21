{
  description = "chrome-devtools-mcp packaged for cross-project reuse in Claude Code .mcp.json";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      mcpVersion = "0.21.0";

      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      eachSystem = f: nixpkgs.lib.genAttrs systems (system:
        f nixpkgs.legacyPackages.${system});

      mkMcp = pkgs: pkgs.writeShellScriptBin "chrome-devtools-mcp" ''
        exec ${pkgs.nodejs}/bin/npx -y chrome-devtools-mcp@${mcpVersion} "$@"
      '';

      perSystem = pkgs: rec {
        mcp = mkMcp pkgs;
        package = { default = mcp; };
        app = {
          default = {
            type = "app";
            program = "${mcp}/bin/chrome-devtools-mcp";
          };
        };
      };
    in
    {
      packages = eachSystem (pkgs: (perSystem pkgs).package);
      apps = eachSystem (pkgs: (perSystem pkgs).app);
    };
}
