@codex-real @real-agent
Feature: Codex detection against a real ollama model
  Codex driven end-to-end by a REAL `codex` CLI pointed at a locally-served
  ollama model through a throwaway $HOME — no fixture writes. The whole e2e suite
  runs ollama, both platforms, no skip-darwin, no mock branch for codex.

  ollama + the model are set up unconditionally by process-compose via
  services-flake (nix/e2e-pc.nix); hooks.ts seeds the throwaway home's
  ~/.codex/config.toml to point codex at ollama's Responses API and fails loud
  if the endpoint is absent. codex is pinned via sadjow/codex-cli-nix.

  Scope note (srid's ruling B-MINIMAL → fallback): like claude-real, this asserts
  DETECTION + real session artifacts, NOT the transient thinking→waiting arc.
  The arc is not deterministically observable on a FAST codex turn — on a fast
  box (Apple Silicon / a rested rasam) the turn is ~1s, so task_started and
  task_complete land within ~1s and the watcher (attached at task_started) can
  miss the task_complete WAL re-read, stranding "thinking". That is the
  append-poll half of the provider watcher robustness bug juspay/kolu#1754 (a
  larger tail read on attach does NOT fix it — the completion write lands AFTER
  attach). When #1754 lands (initial full-scan + append-poll), restore the
  thinking→waiting + working-bucket + token-delta asserts here. The token
  arithmetic + tool_use derivation remain unit-tested (codex index.test.ts).

  Background:
    Given the terminal is ready

  Scenario: A real codex CLI is detected and writes its session artifacts
    When I launch the real Codex agent with prompt "Count from 1 to 40, one number per line. Then reply with only the word DONE."
    # Detection: the tile indicator carries kind=codex — kolu recognized the real
    # codex CLI. No transient-state assert (see the scope note / #1754).
    Then the tile chrome should show a Codex indicator within 60 seconds
    # Session files landed at the REAL default path — under the throwaway home.
    And a real Codex session file should exist at the default path
    And there should be no page errors
