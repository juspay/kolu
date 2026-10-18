@opencode-mock
Feature: OpenCode status detection
  When OpenCode is running in a terminal, the canvas tile chrome shows
  its current state (thinking, tool use, awaiting the user, waiting) and
  context-token total, read from OpenCode 2.x's session store.

  Requires KOLU_OPENCODE_DB to point at a test-controlled path and PATH
  to include an `opencode` binary stub (a renamed `sleep` copy) so the
  foreground-basename check passes without a real OpenCode install.
  Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: OpenCode state updates from thinking to waiting
    When an OpenCode session is mocked with state "thinking"
    Then the tile chrome should show an OpenCode indicator with state "thinking"
    When the OpenCode session state changes to "waiting"
    Then the tile chrome should show an OpenCode indicator with state "waiting"
    And there should be no page errors

  Scenario: Context tokens persist through a subsequent user prompt
    When an OpenCode session is mocked with state "thinking" and context tokens 23000
    Then the tile chrome should show an OpenCode indicator with state "thinking"
    And the tile chrome should show context tokens "23K"
    And there should be no page errors

  Scenario: OpenCode running a tool shows tool use
    When an OpenCode session is mocked with state "tool_use"
    Then the tile chrome should show an OpenCode indicator with state "tool_use"
    And there should be no page errors

  Scenario: OpenCode asking a question shows it is awaiting the user
    When an OpenCode session is mocked with state "awaiting_user"
    Then the tile chrome should show an OpenCode indicator with state "awaiting_user"
    And there should be no page errors

  Scenario: npm-shimmed OpenCode is detected via the OSC 633;E preexec hint
    # The fake-binary scenarios exercise `readForegroundBasename`, the
    # kernel-level half of `matchesAgent`. This one exercises the other
    # half — `lastAgentCommandName`, set from the shell's OSC 633;E preexec
    # hint — which catches interpreter-shimmed agents (kernel basename = "node",
    # not "opencode"). Regression guard for #677.
    When an OpenCode session is mocked with state "thinking" via an npm-shimmed CLI
    Then the tile chrome should show an OpenCode indicator with state "thinking"
    And there should be no page errors
