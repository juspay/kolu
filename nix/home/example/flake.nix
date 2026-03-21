# Example NixOS configuration using kolu's home-manager module.
# Built in CI to ensure the module evaluates correctly.
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    kolu.url = "path:../../..";
    kolu.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, home-manager, kolu, ... }:
    let
      system = "x86_64-linux";
    in
    {
      nixosConfigurations.example = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          home-manager.nixosModules.home-manager
          {
            # Minimal NixOS config for evaluation
            boot.loader.grub.devices = [ "nodev" ];
            fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
            system.stateVersion = "24.11";

            # Example user with kolu enabled via home-manager
            users.users.alice = {
              isNormalUser = true;
              home = "/home/alice";
            };
            home-manager.users.alice = {
              imports = [ kolu.homeManagerModules.default ];
              services.kolu = {
                enable = true;
                package = kolu.packages.${system}.default;
              };
              home.stateVersion = "24.11";
            };
          }
        ];
      };
    };
}
