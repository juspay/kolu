@grok-mock
Feature: Grok status detection
  When Grok Build (`grok`) is running in a terminal, the canvas tile chrome
  shows its current state (thinking, tool use, waiting, awaiting user).

  Requires KOLU_GROK_DIR to point at a test-controlled directory and
  PATH/fake binary so the foreground-basename check passes without a real
  Grok install. Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome shows Grok thinking state
    When a Grok session is mocked with state "thinking"
    Then the tile chrome should show a Grok indicator with state "thinking"
    And there should be no page errors

  Scenario: Tile chrome shows Grok tool-use state
    When a Grok session is mocked with state "tool_use"
    Then the tile chrome should show a Grok indicator with state "tool_use"
    And there should be no page errors

  Scenario: Tile chrome shows Grok waiting state
    When a Grok session is mocked with state "waiting"
    Then the tile chrome should show a Grok indicator with state "waiting"
    And there should be no page errors

  Scenario: Tile chrome shows Grok awaiting-user state
    When a Grok session is mocked with state "awaiting_user"
    Then the tile chrome should show a Grok indicator with state "awaiting_user"
    And there should be no page errors

  # Production Grok often writes active_sessions.json AFTER the process is
  # already foreground (map update is not instantaneous). Detection then
  # depends entirely on the active_sessions externalChanges rewake — the
  # command-run reconcile ladder (0/75/300/1000ms) has already stopped.
  # The happy-path scenarios above write the map inside that window and
  # so cannot catch a dead active_sessions watcher.
  Scenario: Tile chrome lights up when active_sessions is written late
    When a Grok process is running without an active_sessions entry
    And 1500 ms elapse past the command-run reconcile window
    And the active_sessions entry is written for the running Grok process with state "thinking"
    Then the tile chrome should show a Grok indicator with state "thinking"
    And there should be no page errors

  # Initial match emits once from createGrokWatcher; live phase changes
  # only reach the tile if the events.jsonl watcher fires. The happy-path
  # scenarios never rewrite events after match, so a dead session watcher
  # (e.g. parent-dir watch that misses appends) is invisible to e2e.
  Scenario: Tile chrome follows a live events.jsonl state transition
    When a Grok session is mocked with state "thinking"
    Then the tile chrome should show a Grok indicator with state "thinking"
    When the Grok session state changes to "tool_use"
    Then the tile chrome should follow the Grok state change to "tool_use" without nudging
    And there should be no page errors
