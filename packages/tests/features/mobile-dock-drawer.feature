Feature: Mobile dock drawer
  Mobile mirror of the desktop dock. A thin left-edge handle
  opens a left-side swipe drawer (`MobileDockDrawer`) with the same
  structurally-ordered terminal list the desktop dock shows. Tapping a
  row switches the active terminal and dismisses the drawer.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Left-edge handle opens the dock drawer
    When I tap the mobile dock handle
    Then the mobile dock sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Clicking the dock handle (mouse path) opens the drawer without errors
    When I click the mobile dock handle
    Then the mobile dock sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Selecting a row switches active terminal and closes the drawer
    Given I run "echo from-t0"
    And I create a terminal
    When I tap the mobile dock handle
    And I tap the inactive mobile dock row
    Then the active terminal should show "from-t0"
    And the mobile dock sheet should not be visible
    And there should be no page errors

  @mobile
  Scenario: Selecting a split lands in that pane and closes the drawer
    When I create a sub-terminal via command palette
    And I click the main terminal
    And I tap the mobile dock handle
    And I tap mobile dock split sub-entry 1
    Then the mobile dock sheet should not be visible
    And the sub pane should be the active pane
    And there should be no page errors

  @mobile
  Scenario: Tapping the backdrop dismisses the dock drawer
    When I tap the mobile dock handle
    Then the mobile dock sheet should be visible
    When I tap the mobile dock backdrop
    Then the mobile dock sheet should not be visible
    And there should be no page errors

  @mobile
  Scenario: Dismissing the dock via the backdrop does not summon the soft keyboard
    When I tap the terminal canvas
    And I arm the soft-keyboard focus probe
    And I open the dock without moving focus
    Then the mobile dock sheet should be visible
    When I tap the mobile dock backdrop
    Then the mobile dock sheet should not be visible
    And xterm's helper textarea should not have been focused by closing the dock
    And there should be no page errors
