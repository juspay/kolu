@opencode-mock
Feature: OpenCode status detection
  When OpenCode is running in a terminal, the canvas tile chrome shows
  its current state (thinking, tool use, waiting), context-token total,
  and task progress.

  Requires KOLU_OPENCODE_DB to point at a test-controlled path and PATH
  to include an `opencode` binary stub (a renamed `sleep` copy) so the
  foreground-basename check passes without a real OpenCode install.
  Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome shows OpenCode thinking state
    When an OpenCode session is mocked with state "thinking"
    Then the tile chrome should show an OpenCode indicator with state "thinking"
    And there should be no page errors

  Scenario: Tile chrome shows OpenCode tool-use state
    # Regression guard for the state-upgrade path: parseMessageState
    # returns "thinking" for an in-flight assistant message, and the
    # session-watcher only upgrades it to "tool_use" when hasRunningTools()
    # finds a `part` row with state.status="running".
    When an OpenCode session is mocked with state "tool_use"
    Then the tile chrome should show an OpenCode indicator with state "tool_use"
    And there should be no page errors

  Scenario: Tile chrome shows OpenCode waiting state
    When an OpenCode session is mocked with state "waiting"
    Then the tile chrome should show an OpenCode indicator with state "waiting"
    And there should be no page errors

  Scenario: OpenCode state updates from thinking to waiting
    When an OpenCode session is mocked with state "thinking"
    Then the tile chrome should show an OpenCode indicator with state "thinking"
    When the OpenCode session state changes to "waiting"
    Then the tile chrome should show an OpenCode indicator with state "waiting"
    And there should be no page errors

  Scenario: Context tokens persist through a subsequent user prompt
    # Regression guard for the latest-assistant lens at
    # opencode/src/index.ts:180-211: tokens live only on assistant rows,
    # but the thinking-state row is a user message newer than the
    # assistant row. Using the single latest message would blank the
    # count; the separate assistant-scoped query keeps it visible.
    When an OpenCode session is mocked with state "thinking" and context tokens 23000
    Then the tile chrome should show an OpenCode indicator with state "thinking"
    And the tile chrome should show context tokens "23K"
    And there should be no page errors

  Scenario: Tile chrome shows OpenCode task progress
    When an OpenCode session is mocked with state "tool_use" and 5 todos with 3 completed
    Then the tile chrome should show an OpenCode indicator with state "tool_use"
    And the tile chrome should show task progress "3/5"
    And there should be no page errors
