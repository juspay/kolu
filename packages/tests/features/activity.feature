Feature: Terminal activity indicator
  Compact dock shows active (green) vs sleeping (grey) status for each terminal.

  Scenario: New terminal starts active then becomes sleeping
    When I open the app
    And I create a terminal
    Then the terminal should show as active
    When I wait for the terminal to become idle
    Then the terminal should show as sleeping

  Scenario: Running a command makes a sleeping terminal active
    When I open the app
    And I create a terminal
    And I wait for the terminal to become idle
    Then the terminal should show as sleeping
    When I run "echo hello"
    Then the terminal should show as active

  Scenario: Multiple terminals show independent activity states
    When I open the app
    And I create a terminal
    And I create a terminal
    And I wait for the terminal to become idle
    Then terminal 1 should show as sleeping
    And terminal 2 should show as sleeping
    When I select terminal 1 in the sidebar
    And I run "echo wakeup"
    Then terminal 1 should show as active
    And terminal 2 should show as sleeping
