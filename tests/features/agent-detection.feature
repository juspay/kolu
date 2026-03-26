Feature: Agent detection
  Sidebar shows foreground process name and detected AI agent status.

  Scenario: Sidebar shows foreground process name
    When I open the app
    And I create a terminal
    And I wait for the terminal to become idle
    Then the sidebar should show a foreground process

  Scenario: Plain terminal does not show agent status
    When I open the app
    And I create a terminal
    And I run "echo hello"
    And I wait for the terminal to become idle
    Then the sidebar should not show an agent label
