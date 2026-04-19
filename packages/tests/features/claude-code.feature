@claude-mock
Feature: Claude Code status detection
  When Claude Code is running in a terminal, the canvas tile chrome shows
  its current state (thinking, tool use, waiting). The pill tree pings the
  branch when an agent has unread completion.

  Requires KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR env vars
  pointing the server at test-controlled directories.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome shows Claude Code thinking state
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    And there should be no page errors

  Scenario: Claude Code state updates from thinking to waiting
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Claude Code state cycles waiting → thinking → waiting
    When a Claude Code session is mocked with state "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    When the Claude Code session state changes to "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Previous-session JSONL in the project dir doesn't confuse detection
    When a Claude Code session is mocked with state "thinking"
    And a newer stale previous-session JSONL exists in the same project dir
    Then the tile chrome should show an agent indicator with state "thinking"
    And there should be no page errors

  Scenario: Pill tree pings the branch on unread completion
    When a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I simulate an activity alert
    Then a pill tree branch should be notified
    And there should be no page errors

  Scenario: Visiting an unread agent clears its pill ping
    When a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I simulate an activity alert
    Then a pill tree branch should be notified
    When I click the notified pill tree branch
    Then no pill tree branch should be notified
    And there should be no page errors

  Scenario: Tile chrome shows task progress when Claude has tasks
    When a Claude Code session is mocked with state "tool_use"
    And the Claude Code session has 5 tasks with 3 completed
    Then the tile chrome should show task progress "3/5"
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session ends
    Then the tile chrome should not show an agent indicator
    And there should be no page errors
