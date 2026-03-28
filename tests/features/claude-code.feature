Feature: Claude Code status detection
  When Claude Code is running in a terminal, the header and sidebar
  show its current state (thinking, tool use, waiting).

  Background:
    Given the terminal is ready

  Scenario: Header and sidebar show Claude Code thinking state
    When a Claude Code session is mocked with state "thinking"
    Then the header should show a Claude indicator with state "thinking"
    And the sidebar should show a Claude indicator
    And there should be no page errors

  Scenario: Claude Code state updates from thinking to waiting
    When a Claude Code session is mocked with state "thinking"
    Then the header should show a Claude indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the header should show a Claude indicator with state "waiting"
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the header should show a Claude indicator with state "thinking"
    When the Claude Code session ends
    Then the header should not show a Claude indicator
    And there should be no page errors
