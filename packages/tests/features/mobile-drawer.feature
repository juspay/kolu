Feature: Mobile chrome drawer
  On mobile, the persistent chrome bar is replaced by a pull-down
  drawer (`MobileChromeSheet`) carrying global controls — command
  palette, settings, inspector toggle. Tapping the top pull-handle
  opens it; tapping the backdrop dismisses it.

  Terminal navigation lives in a separate left-edge swipe drawer
  (see `mobile-dock-drawer.feature`).

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Pull-handle opens the chrome drawer
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Clicking the pull handle (mouse path) opens the drawer without errors
    When I click the mobile pull handle
    Then the mobile chrome sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Tapping the backdrop dismisses the drawer
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    When I tap the mobile chrome backdrop
    Then the mobile chrome sheet should not be visible
    And there should be no page errors

  @mobile
  Scenario: Palette button in drawer opens the command palette
    When I tap the mobile pull handle
    And I tap the palette button in the drawer
    Then the command palette should be visible
    And the mobile chrome sheet should not be visible
    And there should be no page errors

  @mobile
  Scenario: Dragging down on the pull handle opens the drawer
    When I drag down on the mobile pull handle
    Then the mobile chrome sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Dragging the sheet up past the dismiss threshold closes it
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    When I drag the mobile chrome sheet up to dismiss
    Then the mobile chrome sheet should not be visible
    And there should be no page errors
