Feature: Mobile dock drawer
  Mobile mirror of the desktop dock. A thin left-edge handle
  opens a left-side swipe drawer (`MobileDockDrawer`) with the
  recency-sorted terminal list. Tapping a row switches the active
  terminal and dismisses the drawer.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Left-edge handle opens the dock drawer
    When I tap the mobile dock handle
    Then the mobile dock sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Clicking the dock handle (mouse path) opens the drawer without errors
    # Regression cover for #977 — Corvu @0.2.4 crashed on the mouse-click
    # path because snapPoints defaults weren't applied in time. The tap-based
    # scenario above exercises a different Corvu code path and so missed it.
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
  Scenario: Tapping the backdrop dismisses the dock drawer
    When I tap the mobile dock handle
    Then the mobile dock sheet should be visible
    When I tap the mobile dock backdrop
    Then the mobile dock sheet should not be visible
    And there should be no page errors
