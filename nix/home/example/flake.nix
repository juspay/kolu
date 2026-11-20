{
  inputs = {
    kolu.url = "github:juspay/kolu";
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, home-manager, kolu, ... }:
    let
      linuxSystem = "x86_64-linux";
      darwinSystem = "aarch64-darwin";
      linuxPkgs = nixpkgs.legacyPackages.${linuxSystem};
      darwinPkgs = nixpkgs.legacyPackages.${darwinSystem};

      koluHmModule = { pkgs, ... }: {
        imports = [ kolu.homeManagerModules.default ];
        services.kolu = {
          enable = true;
          package = kolu.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
        home.stateVersion = "24.11";
      };

      darwinHome = home-manager.lib.homeManagerConfiguration {
        pkgs = darwinPkgs;
        modules = [
          koluHmModule
          {
            home.username = "alice";
            home.homeDirectory = "/Users/alice";
          }
        ];
      };

      nixosModule = {
        boot.loader.grub.devices = [ "nodev" ];
        fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
        system.stateVersion = "24.11";

        users.users.alice = {
          isNormalUser = true;
          initialPassword = "pass";
        };

        home-manager.users.alice = koluHmModule;
      };

      exampleSystem = nixpkgs.lib.nixosSystem {
        system = linuxSystem;
        modules = [
          home-manager.nixosModules.home-manager
          nixosModule
        ];
      };
    in
    {
      nixosConfigurations.example = exampleSystem;

      checks.${linuxSystem} = {
        agent-closure-containment = import ./agent-containment.nix {
          pkgs = linuxPkgs;
          inherit kolu;
          generation = exampleSystem.config.system.build.toplevel;
        };

        vm-test = linuxPkgs.testers.nixosTest {
          name = "kolu-service";

          nodes.machine = { ... }: {
            imports = [
              home-manager.nixosModules.home-manager
              nixosModule
            ];

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
            # `</dev/null` (+ bounded `timeout`) is load-bearing on EVERY
            # machinectl call: the driver's stdin pipe never EOFs, so without
            # the redirect a session can hang even after the inner command
            # exits. machinectl also masks the inner exit status, so this is a
            # liveness probe only — the real service assertion is the HTTP
            # listener poll below.
            machine.succeed(
                "timeout 30 machinectl -q shell alice@.host /run/current-system/sw/bin/systemctl --user is-active kolu.service </dev/null"
            )

            # Poll until kolu's HTTP listener binds — systemd reports
            # "active" before the port is open. 120s headroom for hosts
            # without KVM acceleration (qemu TCG fallback inflates kolu's
            # node startup from ~2s to ~22s).
            machine.wait_until_succeeds(
                "curl --fail --silent http://127.0.0.1:7681/ > /dev/null",
                timeout=120,
            )

            # `</dev/null` is load-bearing: machinectl forwards its stdin to the
            # session PTY, and the test driver's stdin pipe never EOFs — without
            # the redirect machinectl never returns even after kaval-tui exits,
            # and a hung attempt hangs the whole lane (wait_until_succeeds only
            # bounds the retry loop, not one attempt). The in-guest `timeout 30`
            # is the belt to that suspender.
            machine.wait_until_succeeds(
                "timeout 30 machinectl -q shell alice@.host /run/current-system/sw/bin/bash -lc 'kaval-tui list' </dev/null",
                timeout=120,
            )
          '';
        };
      }
      // import ./adoption {
        pkgs = linuxPkgs;
        inherit kolu home-manager nixosModule;
        system = linuxSystem;
      };

      checks.${darwinSystem} = {
        home-activation = darwinHome.activationPackage;

        launchd-config =
          let
            agentConfig = darwinHome.config.launchd.agents.kolu.config;
          in
          assert agentConfig.StandardOutPath == "/Users/alice/Library/Logs/kolu.out.log";
          assert agentConfig.StandardErrorPath == "/Users/alice/Library/Logs/kolu.err.log";
          # Restart on non-zero exit AND on crash signals — matches systemd's
          # `Restart = "on-failure"`. `SuccessfulExit` alone misses SIGSEGV etc.
          assert agentConfig.KeepAlive.SuccessfulExit == false;
          assert agentConfig.KeepAlive.Crashed == true;
          darwinPkgs.runCommand "kolu-launchd-config" { } ''
            touch $out
          '';
      };
    };
}
