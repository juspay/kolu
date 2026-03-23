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

    tls = {
      enable = lib.mkEnableOption "TLS with auto-generated self-signed certificate";

      certFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "Path to TLS certificate file (PEM). Overrides self-signed cert.";
      };

      keyFile = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "Path to TLS private key file (PEM). Overrides self-signed cert.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.kolu =
      let
        tlsArgs =
          if cfg.tls.certFile != null && cfg.tls.keyFile != null then
            "--tls-cert ${cfg.tls.certFile} --tls-key ${cfg.tls.keyFile}"
          else if cfg.tls.enable then
            "--tls"
          else
            "";
      in
      {
        Unit = {
          Description = "kolu web terminal multiplexer";
          After = [ "network.target" ];
        };
        Service = {
          ExecStart = "${lib.getExe cfg.package} --host ${cfg.host} --port ${toString cfg.port} ${tlsArgs}";
          Restart = "on-failure";
          Environment = [
            "SHELL=${lib.getExe pkgs.bashInteractive}"
          ];
        };
        Install = {
          WantedBy = [ "default.target" ];
        };
      };
  };
}
