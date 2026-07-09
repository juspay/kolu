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
