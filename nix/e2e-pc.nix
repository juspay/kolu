# Process-compose orchestration for the e2e suite's ollama backend — the
# canonical services-flake form (srid's ruling). No hand-rolled wrapper: ollama
# is declared as a services-flake SERVICE (its data dir, model pull, and HTTP
# readiness probe all come from the module), and the e2e suite runs as the
# process-compose `test` process, gated by the dependency graph on:
#
#   ollama (healthy)  →  ollama-models (model pulled)  →  ollama-warm  →  test
#
# process-compose exits with the `test` process's exit code (the settingsTestFile
# stamps `availability.exit_on_end = true`), so a failing suite fails the lane —
# no false green. Headless via PC_DISABLE_TUI.
#
# services-flake + process-compose-flake are pinned with npins (the repo's
# canonical source mechanism) and imported here via plain module evaluation —
# no flakes / flake-parts needed (process-compose-flake exposes `nix/lib.nix`
# and services-flake exposes `nix/process-compose` as importable module paths).
{ pkgs
, model ? "qwen2.5:0.5b"
  # A fixed loopback port is safe: the `test` recipe serializes the e2e suite
  # across a box with its suite-lock, so only one process-compose runs at a time.
  # Distinctive (not ollama's default 11434) so a developer's own ollama is
  # untouched.
, port ? 41434
  # Model store — pulled here each run (qwen2.5:0.5b is ~400MB / ~15s); off the
  # repo tree so it never dirties the worktree.
, dataDir ? "/tmp/kolu-e2e-ollama-models"
}:
let
  sources = import ../npins;
  pcLib = import (sources.process-compose-flake + "/nix/lib.nix") { inherit pkgs; };
  host = "127.0.0.1";
  # The NODE-distributed codex for the one npm-shim scenario (foreground basename
  # `node`, not `codex` → detection must fall back to the OSC 633;E command-hint).
  # Referenced by absolute path (not on PATH — its bin is also named `codex`).
  codexNode = import ./packages/codex-node.nix { inherit pkgs; };
in
(pcLib.evalModules {
  name = "kolu-e2e-ollama";
  modules = [
    # services-flake's process-compose module. `import` the directory (its
    # relative imports resolve against the pinned source), rather than passing a
    # coerced string path into the modules list.
    (import (sources.services-flake + "/nix/process-compose"))
    ({ ... }: {
      # Headless: no TUI (CI has no tty).
      cli.environment.PC_DISABLE_TUI = true;

      services.ollama."ollama" = {
        enable = true;
        package = pkgs.ollama;
        inherit host port dataDir;
        models = [ model ];
        keepAlive = "30m";
        acceleration = false; # CPU — CI boxes have no GPU
      };

      # Warm the model once it's pulled so the FIRST real agent turn isn't a cold
      # multi-second prompt-processing stall (determinism for the poll-until-state
      # waits). keepAlive holds it loaded for the suite.
      settings.processes.ollama-warm = {
        command = pkgs.writeShellApplication {
          name = "kolu-ollama-warm";
          runtimeInputs = [ pkgs.ollama ];
          text = ''
            export OLLAMA_HOST=${host}:${toString port}
            ollama run ${model} "ok" </dev/null >/dev/null 2>&1 || true
          '';
        };
        depends_on."ollama-models".condition = "process_completed_successfully";
      };

      # The e2e suite itself. Runs only once ollama is healthy and the model is
      # pulled + warmed. KOLU_SERVER / CUCUMBER_* are inherited from the recipe
      # env (process-compose is launched from the e2e shell); KOLU_E2E_OLLAMA_*
      # come from this process's environment.
      settings.processes.test = {
        command = pkgs.writeShellApplication {
          name = "kolu-e2e-suite";
          text = ''
            cd "''${KOLU_REPO_ROOT:?KOLU_REPO_ROOT unset}/packages/tests" || exit 1
            # Word-split any feature selectors the recipe passed (empty = full
            # suite); the array keeps ShellCheck happy.
            read -ra features <<< "''${KOLU_E2E_CUCUMBER_ARGS:-}"
            exec node --import tsx \
              ./node_modules/@cucumber/cucumber/bin/cucumber-js \
              --profile ui "''${features[@]}"
          '';
        };
        depends_on."ollama-warm".condition = "process_completed_successfully";
        environment = {
          KOLU_E2E_OLLAMA_BASE_URL = "http://${host}:${toString port}/v1";
          KOLU_E2E_OLLAMA_MODEL = model;
          KOLU_E2E_CODEX_NODE_BIN = "${codexNode}/bin/codex";
        };
      };
    })
  ];
}).config.outputs.testPackage
