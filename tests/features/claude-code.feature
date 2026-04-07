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

  Scenario: Sidebar shows a live preview for terminals running agents
    When a Claude Code session is mocked with state "thinking"
    Then the sidebar should show a terminal preview
    And there should be no page errors

  Scenario: Disabling the agent previews setting hides the sidebar preview
    When a Claude Code session is mocked with state "thinking"
    Then the sidebar should show a terminal preview
    When I click the settings button
    And I click the agent previews toggle
    Then the sidebar should not show a terminal preview
    And there should be no page errors

  Scenario: Agent sidebar card uses the branch name as the headline when no PR is linked
    When I run "git init /tmp/kolu-agent-headline-test"
    And I run "cd /tmp/kolu-agent-headline-test"
    Then the sidebar should show a branch name
    When a Claude Code session is mocked with state "thinking"
    Then the sidebar should show a terminal preview
    And the sidebar agent headline should show the branch name
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the header should show a Claude indicator with state "thinking"
    When the Claude Code session ends
    Then the header should not show a Claude indicator
    And there should be no page errors
