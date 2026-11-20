@grok-mock
Feature: Grok status detection
  When Grok Build (`grok`) is running in a terminal, the canvas tile chrome
  shows its current state (thinking, tool use, waiting, awaiting user).

  Requires KOLU_GROK_DIR to point at a test-controlled directory and
  PATH/fake binary so the foreground-basename check passes without a real
  Grok install. Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome lights up when active_sessions is written late
    When a Grok process is running without an active_sessions entry
    And 1500 ms elapse past the command-run reconcile window
    And the active_sessions entry is written for the running Grok process with state "thinking"
    Then the tile chrome should show a Grok indicator with state "thinking"
    And there should be no page errors

  Scenario: Tile chrome follows a live events.jsonl state transition
    When a Grok session is mocked with state "thinking"
    Then the tile chrome should show a Grok indicator with state "thinking"
    When the Grok session state changes to "tool_use"
    Then the tile chrome should follow the Grok state change to "tool_use" without nudging
    And there should be no page errors

  Scenario: Tile chrome keeps following Grok after a concurrent grok clobbers active_sessions
    When a Grok session is mocked with state "thinking"
    Then the tile chrome should show a Grok indicator with state "thinking"
    When a concurrent Grok clobbers the active_sessions map
    And the Grok session state changes to "waiting"
    Then the tile chrome should follow the Grok state change to "waiting" without nudging
    And there should be no page errors
