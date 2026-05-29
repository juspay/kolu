{ config, lib, pkgs, ... }:
let
  cfg = config.services.kolu;

  # Three-state TLS: explicit cert+key pair, auto-signed self-signed, or off.
  # The certFile/keyFile pairing is enforced by an assertion below.
  tlsArgs =
    if cfg.tls.certFile != null then
      [ "--tls-cert" (toString cfg.tls.certFile) "--tls-key" (toString cfg.tls.keyFile) ]
    else if cfg.tls.enable then
      [ "--tls" ]
    else
      [ ];

  args = [
    (lib.getExe cfg.package)
    "--host"
    cfg.host
    "--port"
    (toString cfg.port)
  ]
  ++ tlsArgs
  ++ lib.optionals cfg.verbose [ "--verbose" ];

  # Shared by both supervisors. systemd wants `[ "KEY=val" ]`; launchd wants
  # the attrset as a plist dict — converted at each call site.
  envAttrs = lib.optionalAttrs (cfg.diagnostics.dir != null) {
    KOLU_DIAG_DIR = cfg.diagnostics.dir;
  };
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
        example = lib.literalExpression ''"''${config.home.homeDirectory}/.kolu/diag"'';
        description = ''
          Enable memory/heap diagnostics. Value is the base directory under
          which kolu writes per-invocation subdirs containing heap snapshots
          (via --heapsnapshot-near-heap-limit + --heapsnapshot-signal=SIGUSR2)
          and periodic stats logs. `null` disables diagnostics entirely with
          zero overhead. Must be an absolute path — systemd `%h` specifiers
          are not expanded here and would not work on launchd anyway.
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

    # NOTE (R4c, #951): kolu spawns a long-lived `kolu --stdio` PTY-host
    # daemon in its OWN transient systemd unit (`systemd-run --user
    # --unit=kolu-pty-host`) so it survives `systemctl --user restart kolu` (a
    # deploy) and terminals reattach. For that daemon to keep running while
    # kolu-server is down BETWEEN deploys, the user's systemd manager must stay
    # alive without an active login session — i.e. **linger must be enabled**:
    #
    #     loginctl enable-linger $USER        # one-time, needs root/polkit
    #
    # or, on NixOS, `users.users.<name>.linger = true;`. home-manager can't set
    # this itself (it's a system-level, root-owned setting), so it's documented
    # here and in the README. Without linger the daemon still works while you're
    # logged in; it just won't outlive your session.
    systemd.user.services = lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      kolu = {
        Unit = {
          Description = "kolu web terminal multiplexer";
          After = [ "network.target" ];
        };
        Service = {
          ExecStart = toString args;
          Restart = "on-failure";
        } // lib.optionalAttrs (envAttrs != { }) {
          Environment = lib.mapAttrsToList (k: v: "${k}=${v}") envAttrs;
        };
        Install = {
          WantedBy = [ "default.target" ];
        };
      };
    };

    # home-manager activation reloads the LaunchAgent only when the plist
    # bytes change, which means args/env changes drop active terminal sessions.
    launchd.agents = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      kolu = {
        enable = true;
        config = {
          ProgramArguments = args;
          RunAtLoad = true;
          # Match systemd's `Restart = "on-failure"`: restart on non-zero exit
          # AND on crash signals (SIGSEGV, SIGILL, …). `SuccessfulExit` alone
          # only covers clean exits with non-zero status.
          KeepAlive = {
            SuccessfulExit = false;
            Crashed = true;
          };
          # launchd drops stdout/stderr by default; keep service crashes visible.
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/kolu.out.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/kolu.err.log";
        } // lib.optionalAttrs (envAttrs != { }) {
          EnvironmentVariables = envAttrs;
        };
      };
    };
  };
}
