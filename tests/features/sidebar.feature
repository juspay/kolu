Feature: Sidebar
  Multi-terminal creation and switching via the sidebar.

  # Empty state is verified visually — requires a fresh server with no terminals.
  # Tested implicitly: waitForReady() creates a terminal only if empty state is shown.

  Scenario: Create terminal via sidebar
    When I open the app
    And I create a terminal
    Then the terminal canvas should be visible
    And the empty state tip should not be visible

  Scenario: Create second terminal and switch back
    When I open the app
    And I create a terminal
    And I run "echo first-terminal"
    And I create a terminal
    Then the terminal canvas should be visible
    When I select terminal 1 in the sidebar
    Then the active terminal should show "first-terminal"
    And there should be no page errors

  Scenario: Terminals survive browser refresh
    When I open the app
    Given I note the sidebar entry count
    And I create a terminal
    And I create a terminal
    And I refresh the page
    Then the sidebar should have 2 more terminal entries
    And the terminal canvas should be visible
    And there should be no page errors
