@codex-real
Feature: Codex live-state detection against a real ollama model
  Codex's live agent-state pipeline (working → done), driven end-to-end by a
  REAL `codex` CLI pointed at a locally-served ollama model through a throwaway
  $HOME — no fixture writes. This is the unconditional replacement for the mock
  "thinking"/"waiting" codex scenarios (srid's ruling): the whole e2e suite runs
  ollama, both platforms, no skip-darwin, no mock branch for codex STATE. The
  crafted-fixture regression guards that a real turn can't reproduce stay in
  codex.feature.

  ollama + the model are set up unconditionally by process-compose via
  services-flake (nix/e2e-pc.nix); hooks.ts seeds the throwaway home's
  ~/.codex/config.toml to point codex at ollama's Responses API and fails loud
  if the endpoint is absent. codex is pinned to 0.130.0 on every platform
  (nix/packages/codex-pinned.nix) because nixpkgs' 0.114.0 predates the
  threads-table columns kolu's codex provider requires.

  Background:
    Given the terminal is ready

  Scenario: A real codex turn flips the sensor working then done
    # Determinism: a tiny warmed model + a one-word-answer prompt + the existing
    # poll-until-state waits. The turn is ~10-30s of CPU inference, so "done"
    # gets a generous budget while the working window stays observable.
    When I launch the real Codex agent with prompt "Say the single word DONE and then stop."
    # Working: codex is mid-turn (task_started, no task_complete yet).
    Then the tile chrome should show a Codex indicator with state "thinking" within 60 seconds
    And the dock should reflect the Codex agent in the "working" bucket within 60 seconds
    # Done: the turn completed (task_complete) — the sensor leaves "working".
    Then the tile chrome should show a Codex indicator with state "waiting" within 60 seconds
    And the dock should reflect the Codex agent as done within 60 seconds
    # Session files landed at the REAL default path — under the throwaway home.
    And a real Codex session file should exist at the default path
    And there should be no page errors
