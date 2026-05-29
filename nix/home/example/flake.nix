# Example configuration using kolu's home-manager module.
# Built in CI to ensure the module evaluates correctly.
# Linux: NixOS VM test that boots the config and verifies the systemd
# service actually starts. Darwin: standalone home-manager eval-build that
# verifies the launchd path produces a valid plist (no runtime test —
# CI builders don't have a launchd session).
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
      linuxSystem = "x86_64-linux";
      darwinSystem = "aarch64-darwin";
      linuxPkgs = nixpkgs.legacyPackages.${linuxSystem};
      darwinPkgs = nixpkgs.legacyPackages.${darwinSystem};

      # Pure home-manager module — used both inside the NixOS VM (Linux
      # systemd path) and standalone on Darwin (launchd path).
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

      # NixOS module: minimal system + home-manager with kolu enabled.
      nixosModule = {
        boot.loader.grub.devices = [ "nodev" ];
        fileSystems."/" = { device = "none"; fsType = "tmpfs"; };
        system.stateVersion = "24.11";

        users.users.alice = {
          isNormalUser = true;
          # Auto-login so the user session (and its systemd units) starts in the VM
          initialPassword = "pass";
          # R4c (#951): linger keeps alice's systemd --user manager alive
          # without an active login, so the transient `kolu-pty-host` daemon
          # unit (and its PTYs) survives between kolu-server restarts/deploys.
          linger = true;
        };

        home-manager.users.alice = koluHmModule;
      };
    in
    {
      nixosConfigurations.example = nixpkgs.lib.nixosSystem {
        system = linuxSystem;
        modules = [
          home-manager.nixosModules.home-manager
          nixosModule
        ];
      };

      # Linux: VM test boots the config and verifies kolu listens on its port.
      checks.${linuxSystem}.vm-test = linuxPkgs.testers.nixosTest {
        name = "kolu-service";

        nodes.machine = { ... }: {
          imports = [
            home-manager.nixosModules.home-manager
            nixosModule
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
          # "active" before the port is open. 120s headroom for hosts
          # without KVM acceleration (qemu TCG fallback inflates kolu's
          # node startup from ~2s to ~22s).
          machine.wait_until_succeeds(
              "curl --fail --silent http://127.0.0.1:7681/ > /dev/null",
              timeout=120,
          )

          # R4c (#951): the PTY-host daemon must survive a kolu-server restart
          # (a deploy). Create a terminal so the daemon spawns, capture its
          # MainPID, restart kolu-server, and assert the daemon's MainPID is
          # UNCHANGED — the direct regression guard for the cgroup-escape bug
          # (`systemd-run --user --unit` lands it in a sibling cgroup, so
          # `systemctl --user restart kolu` no longer takes it down).
          def alice_user(cmd):
              return machine.succeed(
                  "machinectl -q shell alice@.host "
                  "/run/current-system/sw/bin/systemctl --user " + cmd
              )

          # Spawn a PTY (→ the supervisor spawns the daemon via systemd-run).
          # kolu-server spawns the daemon lazily on the first terminal, so this
          # create is what brings `kolu-pty-host.service` up. oRPC's RPC
          # protocol wraps the input as `{"json": ...}` — a bare `{}` would
          # deserialize to `undefined` and fail create's schema validation.
          machine.succeed(
              "curl --fail --silent -X POST "
              "-H 'content-type: application/json' -d '{\"json\":{}}' "
              "http://127.0.0.1:7681/rpc/terminal/create > /dev/null"
          )
          machine.wait_until_succeeds(
              "machinectl -q shell alice@.host "
              "/run/current-system/sw/bin/systemctl --user is-active kolu-pty-host.service",
              timeout=30,
          )
          pid_before = alice_user(
              "show kolu-pty-host.service --value -p MainPID"
          ).strip()
          assert pid_before not in ("", "0"), f"no daemon MainPID: {pid_before!r}"

          # Restart kolu-server — the deploy. The daemon must NOT restart.
          alice_user("restart kolu.service")
          machine.wait_until_succeeds(
              "curl --fail --silent http://127.0.0.1:7681/ > /dev/null",
              timeout=120,
          )
          pid_after = alice_user(
              "show kolu-pty-host.service --value -p MainPID"
          ).strip()
          assert pid_before == pid_after, (
              f"PTY-host daemon did NOT survive kolu-server restart: "
              f"MainPID {pid_before} -> {pid_after}"
          )
        '';
      };

      # Darwin: standalone home-manager activation package. Building this
      # exercises the launchd.agents.kolu path end-to-end (plist generation,
      # wait4path wrapping, etc.) without needing a live launchd session.
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
