@claude-mock
Feature: Claude Code status detection
  When Claude Code is running in a terminal, the header, sidebar, and
  Mission Control show its current state (thinking, tool use, waiting).

  Requires KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR env vars
  pointing the server at test-controlled directories.

  Background:
    Given the terminal is ready

  Scenario: Header and sidebar show Claude Code thinking state
    When a Claude Code session is mocked with state "thinking"
    Then the header should show an agent indicator with state "thinking"
    And the sidebar should show an agent indicator
    And there should be no page errors

  Scenario: Claude Code state updates from thinking to waiting
    When a Claude Code session is mocked with state "thinking"
    Then the header should show an agent indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the header should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Mission Control shows Claude Code status
    When a Claude Code session is mocked with state "thinking"
    Then the header should show an agent indicator with state "thinking"
    When I click the Mission Control icon
    Then Mission Control should show an agent indicator
    When I press Escape
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the header should show an agent indicator with state "thinking"
    When the Claude Code session ends
    Then the header should not show an agent indicator
    And there should be no page errors
