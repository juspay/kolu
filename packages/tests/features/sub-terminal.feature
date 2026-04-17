@layout-compact
Feature: Sub-terminals
  Per-terminal sub-panels toggled via command palette or Ctrl+`.

  Background:
    Given the terminal is ready

  Scenario: Create sub-terminal via command palette
    When I open the command palette
    And I type "Toggle terminal split" in the palette
    And I press Enter
    Then the sub-panel should be visible
    And the sub-terminal should have keyboard focus
    And the sidebar entry should show sub-terminal count 1
    And there should be no page errors

  Scenario: Toggle sub-panel collapses and refocuses main terminal
    When I create a sub-terminal via command palette
    Then the sub-terminal should have keyboard focus
    When I toggle the sub-panel via command palette
    Then the sub-panel should not be visible
    And the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Re-expanding sub-panel focuses sub-terminal
    When I create a sub-terminal via command palette
    And I toggle the sub-panel via command palette
    Then the main terminal should have keyboard focus
    When I toggle the sub-panel via command palette
    Then the sub-terminal should have keyboard focus
    And there should be no page errors

  Scenario: Sub-terminal persists across collapse/expand
    When I create a sub-terminal via command palette
    And I run "echo sub-marker" in the sub-terminal
    And I toggle the sub-panel via command palette
    And I toggle the sub-panel via command palette
    Then the sub-terminal screen should contain "sub-marker"
    And there should be no page errors

  Scenario: Multiple sub-terminals with tab switching
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    And the sidebar entry should show sub-terminal count 2
    When I click sub-panel tab 1
    Then sub-panel tab 1 should be active
    And there should be no page errors

  Scenario: Kill parent with splits shows confirmation and closes all
    When I open the app
    And I create a terminal
    And I select terminal 1 in the sidebar
    And I create a sub-terminal via command palette
    And I run "echo orphan-marker" in the sub-terminal
    And I click the sidebar close button for terminal 1
    Then the close confirmation should be visible
    When I confirm close all in the close confirmation
    Then the sidebar should have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Sub-terminal exit removes tab
    When I create a sub-terminal via command palette
    And I run "exit" in the sub-terminal
    Then the sub-panel should eventually collapse
    And the sidebar entry should not show a sub-terminal count
    And there should be no page errors

  Scenario: Sub-terminals restore after page refresh
    When I create a sub-terminal via command palette
    And I run "echo refresh-test" in the sub-terminal
    When I refresh the page
    Then the sub-panel should be visible
    And the sidebar entry should show sub-terminal count 1
    And there should be no page errors

  Scenario: Collapsed sub-panel re-expands via toggle
    When I create a sub-terminal via command palette
    And I toggle the sub-panel via command palette
    Then the sub-panel should not be visible
    When I toggle the sub-panel via command palette
    Then the sub-panel should be visible
    And there should be no page errors

  Scenario: Switching away and back remembers main terminal focus
    When I create a sub-terminal via command palette
    And I click the main terminal
    Then the main terminal should have keyboard focus
    When I create a terminal
    And I select sidebar entry 1
    Then the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Switching away and back remembers sub-terminal focus
    When I create a sub-terminal via command palette
    Then the sub-terminal should have keyboard focus
    When I create a terminal
    And I select sidebar entry 1
    Then the sub-terminal should have keyboard focus
    And there should be no page errors

  Scenario: Close sub-terminal via tab close button
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    When I close sub-terminal tab 1
    Then the sub-panel tab bar should have 1 tab
    And the sub-terminal should have keyboard focus
    And the sidebar entry should show sub-terminal count 1
    And there should be no page errors

  Scenario: Close last sub-terminal collapses panel
    When I create a sub-terminal via command palette
    When I close sub-terminal tab 1
    Then the sub-panel should eventually collapse
    And the sidebar entry should not show a sub-terminal count
    And there should be no page errors

  Scenario: Resize handle visible when expanded
    When I create a sub-terminal via command palette
    Then the resize handle should be visible
    And there should be no page errors
