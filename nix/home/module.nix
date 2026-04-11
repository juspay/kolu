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

    verbose = lib.mkEnableOption "debug-level logging";

    diagnostics = {
      dir = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "%h/.kolu/diag";
        description = ''
          Enable memory/heap diagnostics. Value is the base directory under
          which kolu writes per-invocation subdirs containing heap snapshots
          (via --heapsnapshot-near-heap-limit + --heapsnapshot-signal=SIGUSR2)
          and periodic stats logs. `null` disables diagnostics entirely with
          zero overhead. See the PR for the intended workflow.
        '';
      };
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
    assertions = [
      {
        assertion = (cfg.tls.certFile == null) == (cfg.tls.keyFile == null);
        message = "services.kolu.tls.certFile and services.kolu.tls.keyFile must both be set or both be null.";
      }
    ];

    systemd.user.services.kolu = {
      Unit = {
        Description = "kolu web terminal multiplexer";
        After = [ "network.target" ];
      };
      Service = {
        ExecStart = toString ([
          (lib.getExe cfg.package)
          "--host"
          cfg.host
          "--port"
          (toString cfg.port)
        ]
        ++ lib.optionals (cfg.tls.certFile != null) [ "--tls-cert" (toString cfg.tls.certFile) "--tls-key" (toString cfg.tls.keyFile) ]
        ++ lib.optionals (cfg.tls.certFile == null && cfg.tls.enable) [ "--tls" ]
        ++ lib.optionals cfg.verbose [ "--verbose" ]);
        Restart = "on-failure";
      } // lib.optionalAttrs (cfg.diagnostics.dir != null) {
        Environment = [ "KOLU_DIAG_DIR=${cfg.diagnostics.dir}" ];
      };
      Install = {
        WantedBy = [ "default.target" ];
      };
    };
  };
}
