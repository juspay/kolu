# Example NixOS configuration using kolu's home-manager module.
# Built in CI to ensure the module evaluates correctly.
# Also provides a VM test that verifies the service actually starts.
{
  inputs = {
    # In CI, vira overrides this to the repo root via overrideInputs.
    kolu.url = "github:juspay/kolu";
    nixpkgs.follows = "kolu/nixpkgs";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, home-manager, kolu, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      # Shared NixOS module: minimal system + home-manager with kolu enabled
      koluModule = {
        boot.loader.grub.devices = [ "nodev" ];
        fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
        system.stateVersion = "24.11";

        users.users.alice = {
          isNormalUser = true;
          # Auto-login so the user session (and its systemd units) starts in the VM
          initialPassword = "pass";
        };

        home-manager.users.alice = {
          imports = [ kolu.homeManagerModules.default ];
          services.kolu = {
            enable = true;
            package = kolu.packages.${system}.default;
          };
          home.stateVersion = "24.11";
        };
      };
    in
    {
      nixosConfigurations.example = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          home-manager.nixosModules.home-manager
          koluModule
        ];
      };

      # VM test: boots the config and verifies kolu listens on its port
      checks.${system}.vm-test = pkgs.testers.nixosTest {
        name = "kolu-service";

        nodes.machine = { ... }: {
          imports = [
            home-manager.nixosModules.home-manager
            koluModule
          ];

          # Auto-login alice so her user session starts
          services.getty.autologinUser = "alice";
        };

        testScript = ''
          machine.wait_for_unit("multi-user.target")
          # Wait for alice's user session to come up
          machine.wait_for_unit("user@1000.service")
          # The home-manager service should activate kolu
          machine.succeed("sleep 5")  # give the user service time to start
          machine.succeed(
              "su - alice -c 'systemctl --user status kolu.service'"
          )
          # Verify kolu is listening on the default port
          machine.succeed(
              "curl --fail --silent http://127.0.0.1:7681/ > /dev/null"
          )
        '';
      };
    };
}
