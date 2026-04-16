Feature: Right panel pin/unpin
  The right panel can be pinned (docked via resizable split) or unpinned
  (overlay with backdrop). Pin toggle is in the right panel tab bar.

  Background:
    Given the terminal is ready

  Scenario: Right panel is pinned by default
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the right panel pin button should show pinned
    And the right panel resize handle should be visible
    And there should be no page errors

  Scenario: Unpin makes panel overlay with backdrop
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel pin toggle
    Then the right panel pin button should show unpinned
    And the right panel should be visible
    And there should be no page errors

  Scenario: Backdrop click closes unpinned panel
    When I press the toggle inspector shortcut
    When I click the right panel pin toggle
    Then the right panel should be visible
    When I click the right panel backdrop
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Re-pin switches back to docked mode
    When I press the toggle inspector shortcut
    When I click the right panel pin toggle
    Then the right panel pin button should show unpinned
    When I click the right panel pin toggle
    Then the right panel pin button should show pinned
    And the right panel resize handle should be visible
    And there should be no page errors

  Scenario: Escape closes unpinned overlay panel
    When I press the toggle inspector shortcut
    When I click the right panel pin toggle
    Then the right panel should be visible
    When I press Escape
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Pin state persists across reload
    When I press the toggle inspector shortcut
    When I click the right panel pin toggle
    Then the right panel pin button should show unpinned
    # Close the panel before reload so collapsed=true persists
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I reload the page and wait for ready
    When I wait for server state sync
    # Re-open — should still be unpinned (overlay mode)
    When I press the toggle inspector shortcut
    Then the right panel pin button should eventually show unpinned
    And there should be no page errors
