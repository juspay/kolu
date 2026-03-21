# Home-manager module for kolu web terminal multiplexer
{ config, lib, pkgs, ... }:
let
  cfg = config.services.kolu;
in
{
  options.services.kolu = {
    enable = lib.mkEnableOption "kolu web terminal multiplexer";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The kolu package to use.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address to listen on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 7681;
      description = "Port to listen on.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.kolu = {
      Unit = {
        Description = "kolu web terminal multiplexer";
        After = [ "network.target" ];
      };
      Service = {
        ExecStart = "${cfg.package}/bin/kolu --host ${cfg.host} --port ${toString cfg.port}";
        Restart = "on-failure";
        Environment = [
          "SHELL=${pkgs.bashInteractive}/bin/bash"
        ];
      };
      Install = {
        WantedBy = [ "default.target" ];
      };
    };
  };
}
