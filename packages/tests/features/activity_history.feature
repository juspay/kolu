Feature: Server-side activity history
  Late-joining clients (page refresh, new tab) receive the full activity
  sparkline history from the server instead of starting empty.

  Scenario: Activity graph persists across page refresh
    When I open the app
    And I create a terminal
    And I run "echo hello"
    And I wait for the terminal to become idle
    Then the activity graph should have data
    When I refresh the page
    Then the activity graph should have data
