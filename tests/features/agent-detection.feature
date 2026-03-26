Feature: Agent detection
  Sidebar shows detected AI agent status (e.g. Claude Code) for terminals.

  Scenario: Terminal output matching Claude Code is detected
    When I open the app
    And I create a terminal
    And I run "echo 'Claude Code v1.0'"
    And I wait for the terminal to become idle
    Then the sidebar should show agent "claude-code"

  Scenario: Plain terminal does not show agent status
    When I open the app
    And I create a terminal
    And I run "echo hello"
    And I wait for the terminal to become idle
    Then the sidebar should not show an agent label
