# Example NixOS configuration using kolu's home-manager module.
# Built in CI to ensure the module evaluates correctly.
# Also provides a VM test that verifies the service actually starts.
{
  inputs = {
    # In CI, localci builds this with --override-input kolu pointing to the repo root.
    kolu.url = "github:juspay/kolu";
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
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
          # Poll for alice's user session. wait_for_unit fails fast if the
          # unit is still inactive with no pending job — a race with
          # auto-login queueing user@1000. wait_until_succeeds retries.
          machine.wait_until_succeeds(
              "systemctl is-active user@1000.service",
              timeout=60,
          )

          # Use machinectl shell to get a proper user session with
          # DBUS_SESSION_BUS_ADDRESS and XDG_RUNTIME_DIR set.
          # Plain `su` doesn't set these, so systemctl --user fails.
          machine.succeed(
              "machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user is-active kolu.service"
          )

          # Poll until kolu's HTTP listener binds — systemd reports
          # "active" before the port is open.
          machine.wait_until_succeeds(
              "curl --fail --silent http://127.0.0.1:7681/ > /dev/null",
              timeout=30,
          )
        '';
      };
    };
}
