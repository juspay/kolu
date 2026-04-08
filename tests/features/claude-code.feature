@claude-mock
Feature: Claude Code status detection
  When Claude Code is running in a terminal, the header and sidebar
  show its current state (thinking, tool use, waiting).

  Requires KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR env vars
  pointing the server at test-controlled directories.

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

  Scenario: Claude Code state cycles waiting → thinking → waiting
    When a Claude Code session is mocked with state "waiting"
    Then the header should show a Claude indicator with state "waiting"
    When the Claude Code session state changes to "thinking"
    Then the header should show a Claude indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the header should show a Claude indicator with state "waiting"
    And there should be no page errors

  Scenario: Previous-session JSONL in the project dir doesn't confuse detection
    When a Claude Code session is mocked with state "thinking"
    And a newer stale previous-session JSONL exists in the same project dir
    Then the header should show a Claude indicator with state "thinking"
    And there should be no page errors

  # Preview shows only when the agent is waiting on the user or has an unread completion.
  # A "thinking" agent is busy but doesn't need attention — see shouldShowPreview() in Sidebar.tsx.
  Scenario: Sidebar shows a live preview for agents waiting on the user
    When a Claude Code session is mocked with state "waiting"
    Then the sidebar should show a terminal preview
    And there should be no page errors

  Scenario: Sidebar hides the preview for thinking agents
    When a Claude Code session is mocked with state "thinking"
    Then the sidebar should not show a terminal preview
    And there should be no page errors

  Scenario: Setting agent previews to "none" hides the sidebar preview
    When a Claude Code session is mocked with state "waiting"
    Then the sidebar should show a terminal preview
    When I click the settings button
    And I set the agent previews mode to "none"
    Then the sidebar should not show a terminal preview
    And there should be no page errors

  Scenario: Setting agent previews to "agents" shows preview for any agent regardless of state
    When a Claude Code session is mocked with state "thinking"
    Then the sidebar should not show a terminal preview
    When I click the settings button
    And I set the agent previews mode to "agents"
    Then the sidebar should show a terminal preview
    And there should be no page errors

  Scenario: Debug command shows the Claude transcript when a session is active
    When a Claude Code session is mocked with state "waiting"
    Then the header should show a Claude indicator with state "waiting"
    When I open the command palette
    And I select "Debug" in the palette
    Then palette item "Show Claude transcript" should be visible
    When I select "Show Claude transcript" in the palette
    Then the Claude transcript dialog should be visible
    And the Claude transcript dialog should show at least 1 disk event
    And there should be no page errors

  Scenario: Debug command is hidden when no Claude session is active
    When I open the command palette
    And I select "Debug" in the palette
    Then palette item "Show Claude transcript" should not be visible
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the header should show a Claude indicator with state "thinking"
    When the Claude Code session ends
    Then the header should not show a Claude indicator
    And there should be no page errors
