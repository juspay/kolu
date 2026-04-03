Feature: Split terminals
  Terminal splits toggled via command palette or Ctrl+`.

  Background:
    Given the terminal is ready

  Scenario: Create split terminal via command palette
    When I open the command palette
    And I type "Toggle terminal split" in the palette
    And I press Enter
    Then the split panel should be visible
    And the split terminal should have keyboard focus
    And the sidebar entry should show split count 1
    And there should be no page errors

  Scenario: Toggle split collapses and refocuses main terminal
    When I create a split terminal via command palette
    Then the split terminal should have keyboard focus
    When I toggle the terminal split via command palette
    Then the split panel should not be visible
    And the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Re-expanding split focuses split terminal
    When I create a split terminal via command palette
    And I toggle the terminal split via command palette
    Then the main terminal should have keyboard focus
    When I toggle the terminal split via command palette
    Then the split terminal should have keyboard focus
    And there should be no page errors

  Scenario: Split terminal persists across collapse/expand
    When I create a split terminal via command palette
    And I run "echo sub-marker" in the split terminal
    And I toggle the terminal split via command palette
    And I toggle the terminal split via command palette
    Then the split terminal screen should contain "sub-marker"
    And there should be no page errors

  Scenario: Multiple split terminals with tab switching
    When I create a split terminal via command palette
    And I create another split terminal via command palette
    Then the split tab bar should have 2 tabs
    And the sidebar entry should show split count 2
    When I click split tab 1
    Then split tab 1 should be active
    And there should be no page errors

  Scenario: Kill parent promotes split terminals to sidebar
    When I open the app
    And I create a terminal
    And I select terminal 1 in the sidebar
    And I create a split terminal via command palette
    And I run "echo orphan-marker" in the split terminal
    And I close terminal 1 via sidebar
    Then the sidebar should have 2 terminal entries
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Split terminal exit removes tab
    When I create a split terminal via command palette
    And I run "exit" in the split terminal
    Then the split panel should eventually collapse
    And the sidebar entry should not show a split count
    And there should be no page errors

  Scenario: Split terminals restore after page refresh
    When I create a split terminal via command palette
    And I run "echo refresh-test" in the split terminal
    When I refresh the page
    Then the split panel should be visible
    And the sidebar entry should show split count 1
    And there should be no page errors

  Scenario: Collapsed indicator visible when split is collapsed
    When I create a split terminal via command palette
    And I toggle the terminal split via command palette
    Then the collapsed indicator should be visible
    When I toggle the terminal split via command palette
    Then the split panel should be visible
    And there should be no page errors

  Scenario: Switching away and back remembers main terminal focus
    When I create a split terminal via command palette
    And I click the main terminal
    Then the main terminal should have keyboard focus
    When I create a terminal
    And I select sidebar entry 1
    Then the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Switching away and back remembers split terminal focus
    When I create a split terminal via command palette
    Then the split terminal should have keyboard focus
    When I create a terminal
    And I select sidebar entry 1
    Then the split terminal should have keyboard focus
    And there should be no page errors

  Scenario: Resize handle visible when expanded
    When I create a split terminal via command palette
    Then the resize handle should be visible
    And there should be no page errors

  Scenario: Split bar visible when no splits exist
    Then the split bar should be visible
    And there should be no page errors
