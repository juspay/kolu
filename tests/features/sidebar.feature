Feature: Sidebar
  Multi-terminal creation and switching via the sidebar.

  # Empty state is verified visually — requires a fresh server with no terminals.
  # Tested implicitly: waitForReady() creates a terminal only if empty state is shown.

  Scenario: Create terminal via sidebar
    When I open the app
    And I create a workspace
    Then the terminal canvas should be visible
    And the empty state tip should not be visible

  Scenario: Create second terminal and switch back
    When I open the app
    And I create a workspace
    And I run "echo first-terminal"
    And I create a workspace
    Then the terminal canvas should be visible
    When I select workspace 1 in the sidebar
    Then the active workspace should show "first-terminal"
    And there should be no page errors

  Scenario: Switching terminals auto-focuses the terminal
    When I open the app
    And I create a workspace
    And I create a workspace
    When I select workspace 1 in the sidebar
    Then the workspace should have keyboard focus

  Scenario: Terminals survive browser refresh
    When I open the app
    Given I note the sidebar entry count
    And I create a workspace
    And I create a workspace
    And I refresh the page
    Then the sidebar should have 2 more workspace entries
    And the terminal canvas should be visible
    # Run post-refresh commands to verify each terminal is alive and connected
    # to its original PTY (terminal count check above proves no new PTYs spawned).
    # We don't check pre-refresh screen content because shell SIGWINCH handlers
    # may clear the screen on resize, destroying previous output.
    When I select workspace 2 in the sidebar
    And I run "echo alive-bbb"
    Then the active workspace should show "alive-bbb"
    When I select workspace 1 in the sidebar
    And I run "echo alive-aaa"
    Then the active workspace should show "alive-aaa"
    And there should be no page errors
