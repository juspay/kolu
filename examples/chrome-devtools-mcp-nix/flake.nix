{
  description = "chrome-devtools-mcp packaged for cross-project reuse in Claude Code .mcp.json";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      mcpVersion = "0.21.0";

      eachSystem = f: nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed
        (system: f nixpkgs.legacyPackages.${system});

      mkMcp = pkgs: pkgs.writeShellScriptBin "chrome-devtools-mcp" ''
        exec ${pkgs.nodejs}/bin/npx -y chrome-devtools-mcp@${mcpVersion} "$@"
      '';

      perSystem = eachSystem (pkgs:
        let mcp = mkMcp pkgs; in {
          packages.default = mcp;
          apps.default = {
            type = "app";
            program = "${mcp}/bin/chrome-devtools-mcp";
          };
        });
    in
    {
      packages = nixpkgs.lib.mapAttrs (_: s: s.packages) perSystem;
      apps = nixpkgs.lib.mapAttrs (_: s: s.apps) perSystem;
    };
}
