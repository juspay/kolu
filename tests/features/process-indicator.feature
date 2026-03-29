Feature: Foreground process indicator
  The sidebar shows the name of the active foreground process running
  in each terminal. When the process exits, the indicator disappears.

  Background:
    Given the terminal is ready

  Scenario: Sidebar shows foreground process name
    When I run "sleep 30"
    Then the sidebar should show process "sleep"
    And there should be no page errors

  Scenario: Process indicator disappears when process exits
    When I run "sleep 30"
    Then the sidebar should show process "sleep"
    When I send Ctrl+C to the terminal
    Then the sidebar should not show a process indicator
    And there should be no page errors
