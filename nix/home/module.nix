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

  # `web` is spelled explicitly: bare `kolu` lists its subcommands and exits
  # non-zero now (it stopped being an alias for the server when the terminal
  # verbs landed), and the bind address is `--bind` — `--host` means "which
  # padi" on every verb, so the server's listen address took the clearer name.
  args = [
    (lib.getExe cfg.package)
    "web"
    "--bind"
    cfg.host
    "--port"
    (toString cfg.port)
  ]
  ++ tlsArgs
  ++ lib.optionals cfg.verbose [ "--verbose" ];

  # ── I1 (juspay/kolu#2101): the generation IS the agent depot ────────────────
  # Every agent closure a connect from this deployment can provision, aggregated
  # into ONE symlink forest so the generation has a single thing to point at.
  #
  # WHY THIS EXISTS AT ALL. `padi-agent` — the attr both dial paths resolve — is
  # NOT in `.#default`'s closure and never can be: it *contains* `default`. So a
  # deploy used to install the server plus the baked agent SOURCE, learn the
  # closure's store path at dial time, and then have to fetch the bits from a
  # cache or compile them on the target host. That is the production incident
  # (F5a, G7). The DEPLOYED ARTIFACT is not `.#default` though — it is this
  # home-manager generation, and a generation may reference both `default` and
  # `padi-agent` with no cycle. Referencing them here makes "the binder holds
  # every agent closure it can ship" true BY CONSTRUCTION, on every host that
  # deploys the module, with no cache and no preflight.
  #
  # WHY NOT `home.packages`. `padi-agent/bin` carries `kolu`, `kaval-tui` and
  # `padi-tui` (it is the remote toolchain), which collide with `cliPackage` /
  # `tuiPackage` / `padiTuiPackage` in the profile buildEnv. The closures must
  # be IN the generation, not ON `$PATH`; a linkFarm referenced from the service
  # definition is exactly that and nothing more.
  #
  # WHAT IT COSTS — MEASURED, NOT ESTIMATED. On x86_64-linux at this branch's
  # HEAD, `.#default`'s closure is 776,842,136 B / 139 paths and
  # `.#padi-agent`'s is 776,843,896 B / 140 paths: a delta of **1,760 bytes,
  # exactly ONE store path** (the buildEnv symlink forest itself). `padi`,
  # `kaval`, `kaval-tui` and `padi-tui` already sit inside `default`'s closure,
  # so deduplication makes all of them free. End to end, the example's deployed
  # generation goes 739 → 741 paths and 2,130,132,144 → 2,130,134,536 B: **+2
  # store paths, +2,392 bytes**, i.e. +0.0001% — nowhere near the ≥10% stop
  # threshold the round was given.
  agentClosures = pkgs.linkFarm "kolu-agent-closures"
    (map (p: { name = lib.getName p; path = p; }) cfg.agentPackages);

  # Shared by both supervisors. systemd wants `[ "KEY=val" ]`; launchd wants
  # the attrset as a plist dict — converted at each call site. Carries the
  # baked-agent anchor, the optional diagnostics dir, and the optional
  # WebSocket Origin allowlist.
  #
  # `KOLU_BAKED_AGENT_CLOSURES` IS READ BY NOTHING, ON PURPOSE. An env var no
  # code consults is normally a smell; here the VALUE is the point. It is a
  # store-path reference on the unit file, so the agent closures are (a) in the
  # generation's closure, (b) GC-rooted for exactly as long as the generation is
  # — nothing extra to arm, nothing to expire — and (c) anchored on the very
  # unit whose connects are the reason they must exist, where a reader meets
  # them. Deleting it does not break a build; it re-opens the incident. The
  # `agent-closure-containment` check in nix/home/example/ is what fails if it
  # ever stops holding.
  envAttrs =
    {
      KOLU_BAKED_AGENT_CLOSURES = "${agentClosures}";
    }
    // lib.optionalAttrs (cfg.diagnostics.dir != null) {
      KOLU_DIAG_DIR = cfg.diagnostics.dir;
    }
    // lib.optionalAttrs (cfg.allowedOrigins != [ ]) {
      KOLU_ALLOWED_ORIGINS = lib.concatStringsSep "," cfg.allowedOrigins;
    };
in
{
  options.services.kolu = {
    enable = lib.mkEnableOption "kolu web terminal multiplexer";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The kolu package to use.";
    };

    tuiPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = ''
        The `kaval-tui` CLI package to install onto PATH alongside the running
        server. When non-null, `kaval-tui` is added to `home.packages` so
        `kaval-tui list` / `kaval-tui snapshot` work from any shell. The flake's
        `homeManagerModules.default` defaults this to the matching `kaval-tui`
        build for the host platform, so the CLI ships automatically with the
        service; set it to `null` to opt out, or to an explicit package to pin a
        particular build. (Until the daemon flip, point it at the server with
        `kaval-tui --socket $XDG_RUNTIME_DIR/kolu/pty-host.sock`.)
      '';
    };

    padiTuiPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = ''
        The `padi-tui` CLI package to install onto PATH alongside `kaval-tui`.
        Where `kaval-tui` shows what's *running* in each terminal, `padi-tui`
        shows what each terminal *is in* (record state · agent · live byte
        activity), and `padi-tui wait` blocks until an agent's turn ends — the
        done-signal for driving one agent from another. When non-null it is added
        to `home.packages`; the flake's `homeManagerModules.default` defaults this
        to the matching `padi-tui` build, so it ships automatically with the
        service. Set to `null` to opt out, or to an explicit package to pin a
        build. (`padi-tui` reads the running padi daemon; inside a kolu terminal
        `$PADI_SOCKET` makes it flagless.)
      '';
    };

    agentPackages = lib.mkOption {
      # `nonEmptyListOf`, NOT `listOf` — the difference is the whole point.
      # `listOf` carries an `emptyValue` (nixpkgs lib/types.nix), so an option
      # of that type with no `default` is not required at all: an omitting
      # consumer silently evaluates to `[ ]`. Measured on a bare-module
      # `homeManagerConfiguration` that set only `package`, and it evaluated
      # green. `nonEmptyListOf` drops `emptyValue`, so omission throws — and it
      # additionally rejects an EXPLICIT `[ ]`, which is the same defect spelled
      # out loud.
      type = lib.types.nonEmptyListOf lib.types.package;
      example = lib.literalExpression ''[ kolu.packages.''${system}.padi-agent ]'';
      description = ''
        Every agent closure this deployment can provision onto a remote host;
        the generation carries and GC-roots them so a connect never consults a
        cache or realises from source (I1, juspay/kolu#2101).

        REQUIRED, with no default — deliberately. Like `package` and unlike
        `tuiPackage`, there is no honest empty value: a deployment that names no
        agent closures is one whose first remote connect compiles a daemon over
        ssh, which is the incident this option exists to abolish. A bare-module
        consumer must state the set or fail at eval rather than silently
        degrade. The flake's `homeManagerModules.default` defaults it to the
        packages named by `nix/agent-packages.json`'s `expose` list — the same
        manifest `ci/agent-substitutable`, `ci/agent-preflight` and
        `nix/agent-flake.nix` read — so the set can never skew from what a
        remote is actually allowed to resolve.
      '';
    };

    cliPackage = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = cfg.package;
      defaultText = lib.literalExpression "config.services.kolu.package";
      description = ''
        The `kolu` binary to install onto PATH alongside the running service —
        so the CLI faces work from any shell: `kolu mcp` (serve this host's
        terminals to a coding agent over MCP stdio) and `kolu web`. Defaults to
        the service's own package, so the binary on PATH can never skew from
        the daemon it dials; set to `null` to opt out, or to an explicit
        package to pin a build.
      '';
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

    allowedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = lib.literalExpression ''[ "https://box.tailnet.ts.net" ]'';
      description = ''
        Extra browser origins allowed to reach kolu's unauthenticated RPC
        surface — both the `/rpc/ws` WebSocket and the `/rpc/*` HTTP handler
        (the `KOLU_ALLOWED_ORIGINS` env var — a Cross-Site WebSocket Hijacking
        / cross-site-request defense). Same-origin requests are always allowed;
        list additional origins here when a reverse proxy (e.g. `tailscale
        serve`) serves the UI from a different origin than the `Host` kolu
        receives. Empty leaves only the same-origin rule.
      '';
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
          and periodic stats logs — for BOTH the kolu server and the spawned
          `kaval` PTY daemon (kaval lands in its own `kaval-*` subdir; it is the
          process that historically OOM'd, see the kaval-heap-oom Atlas note).
          `null` disables diagnostics entirely with zero overhead. Must be an
          absolute path — systemd `%h` specifiers are not expanded here and
          would not work on launchd anyway.
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

    # Ship the terminal-side CLIs (kaval-tui + padi-tui) AND the kolu binary
    # itself on PATH so they can reach a pty-host / padi socket from any
    # shell — `kolu mcp` is how a coding agent gets this host's terminals.
    # Each is skipped only when its package is explicitly set null.
    home.packages =
      lib.optional (cfg.tuiPackage != null) cfg.tuiPackage
      ++ lib.optional (cfg.padiTuiPackage != null) cfg.padiTuiPackage
      ++ lib.optional (cfg.cliPackage != null) cfg.cliPackage;

    systemd.user.services = lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      kolu = {
        Unit = {
          Description = "kolu web terminal multiplexer";
          After = [ "network.target" ];
        };
        Service = {
          ExecStart = toString args;
          Restart = "on-failure";
          # Always non-empty: `KOLU_BAKED_AGENT_CLOSURES` is unconditional, and
          # it is this line that puts the agent closures in the generation.
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
          # Always non-empty — same reason as the systemd `Environment` above:
          # this is the darwin seat of the baked-agent anchor.
          EnvironmentVariables = envAttrs;
        };
      };
    };
  };
}
