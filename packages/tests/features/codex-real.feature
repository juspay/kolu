@codex-real @real-agent
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
    # Determinism: a tiny warmed model + an enumerated-list prompt that lasts a
    # few seconds of CPU inference, so codex's session watcher attaches DURING
    # the turn (thinking observable) and the task_complete write then fires a WAL
    # change → waiting. A one-word answer is sub-second on a fast box (Apple
    # Silicon: ~0.8s): the watcher can attach at the exact turn-end and miss the
    # completion, wedging on "thinking" — the fast-box race this longer turn
    # closes. The count is not asserted (only the state arc), so model drift is
    # harmless.
    When I launch the real Codex agent with prompt "Count from 1 to 40, one number per line. Then reply with only the word DONE."
    # Working: codex is mid-turn (task_started, no task_complete yet).
    Then the tile chrome should show a Codex indicator with state "thinking" within 60 seconds
    And the dock should reflect the Codex agent in the "working" bucket within 60 seconds
    # Done: the turn completed (task_complete) — the sensor leaves "working".
    Then the tile chrome should show a Codex indicator with state "waiting" within 60 seconds
    And the dock should reflect the Codex agent as done within 60 seconds
    # Context tokens (behavioral send-observe-delta, srid's ratified shape): the
    # real turn consumed tokens, so kolu's context-token badge reads non-zero —
    # increased from the fresh session's nothing. The exact per-turn /
    # no-double-count-cache arithmetic stays a unit test (codex index.test.ts).
    And the tile chrome should show a non-zero Codex context-token count within 60 seconds
    # Session files landed at the REAL default path — under the throwaway home.
    And a real Codex session file should exist at the default path
    And there should be no page errors
