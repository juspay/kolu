Feature: Terminal panel
  Per-workspace terminal panels toggled via command palette or Ctrl+`.

  Background:
    Given the terminal is ready

  Scenario: Create terminal via command palette
    When I open the command palette
    And I type "Toggle terminal" in the palette
    And I press Enter
    Then the terminal panel should be visible
    And the terminal should have keyboard focus
    And the sidebar entry should show terminal count 1
    And there should be no page errors

  Scenario: Toggle terminal panel collapses and refocuses main terminal
    When I create a terminal via command palette
    Then the terminal should have keyboard focus
    When I toggle the terminal panel via command palette
    Then the terminal panel should not be visible
    And the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Re-expanding terminal panel focuses terminal
    When I create a terminal via command palette
    And I toggle the terminal panel via command palette
    Then the main terminal should have keyboard focus
    When I toggle the terminal panel via command palette
    Then the terminal should have keyboard focus
    And there should be no page errors

  Scenario: Terminal persists across collapse/expand
    When I create a terminal via command palette
    And I run "echo sub-marker" in the terminal panel
    And I toggle the terminal panel via command palette
    And I toggle the terminal panel via command palette
    Then the terminal panel screen should contain "sub-marker"
    And there should be no page errors

  Scenario: Multiple terminals with tab switching
    When I create a terminal via command palette
    And I create another terminal via command palette
    Then the terminal panel tab bar should have 2 tabs
    And the sidebar entry should show terminal count 2
    When I click terminal panel tab 1
    Then terminal panel tab 1 should be active
    And there should be no page errors

  Scenario: Kill parent promotes terminals to sidebar
    When I open the app
    And I create a workspace
    And I select workspace 1 in the sidebar
    And I create a terminal via command palette
    And I run "echo orphan-marker" in the terminal panel
    And I close workspace 1 via sidebar
    Then the sidebar should have 2 workspace entries
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Terminal exit removes tab
    When I create a terminal via command palette
    And I run "exit" in the terminal panel
    Then the terminal panel should eventually collapse
    And the sidebar entry should not show a terminal count
    And there should be no page errors

  Scenario: Terminals restore after page refresh
    When I create a terminal via command palette
    And I run "echo refresh-test" in the terminal panel
    When I refresh the page
    Then the terminal panel should be visible
    And the sidebar entry should show terminal count 1
    And there should be no page errors

  Scenario: Collapsed indicator visible when terminal panel is collapsed
    When I create a terminal via command palette
    And I toggle the terminal panel via command palette
    Then the collapsed indicator should be visible
    When I toggle the terminal panel via command palette
    Then the terminal panel should be visible
    And there should be no page errors

  Scenario: Switching away and back remembers main terminal focus
    When I create a terminal via command palette
    And I click the main terminal
    Then the main terminal should have keyboard focus
    When I create a workspace
    And I select sidebar entry 1
    Then the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Switching away and back remembers terminal focus
    When I create a terminal via command palette
    Then the terminal should have keyboard focus
    When I create a workspace
    And I select sidebar entry 1
    Then the terminal should have keyboard focus
    And there should be no page errors

  Scenario: Resize handle visible when expanded
    When I create a terminal via command palette
    Then the resize handle should be visible
    And there should be no page errors
