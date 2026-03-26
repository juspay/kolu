Feature: Sub-terminals
  Per-terminal sub-panels toggled via command palette or Ctrl+`.

  Background:
    Given the terminal is ready

  Scenario: Create sub-terminal via command palette
    When I open the command palette
    And I type "Toggle sub" in the palette
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
