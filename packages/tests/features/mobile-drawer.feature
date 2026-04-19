Feature: Mobile chrome drawer
  On mobile the persistent pill tree and chrome bar are replaced by a
  pull-down drawer (`MobileChromeSheet`). Tapping the pull-handle opens
  it; tapping a pill switches the active terminal and dismisses the
  drawer; tapping the backdrop dismisses without switching.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Pull-handle opens the chrome drawer
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Selecting a pill in the drawer switches active terminal and closes
    Given I run "echo from-t0"
    And I create a terminal
    When I tap the mobile pull handle
    And I tap the inactive mobile pill branch
    Then the active terminal should show "from-t0"
    And the mobile chrome sheet should not be visible
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
    # The grip visually invites a drag; this proves the drag gesture on the
    # handle opens the sheet even when the touch never resolves to a click.
    When I drag down on the mobile pull handle
    Then the mobile chrome sheet should be visible
    And there should be no page errors

  @mobile
  Scenario: Dragging the sheet up past the dismiss threshold closes it
    # Corvu attaches the drag-to-dismiss handlers to Drawer.Content; for a
    # `side="top"` drawer the dismiss direction is upward. Open, drag the
    # sheet up most of its height, release — the sheet should snap closed.
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    When I drag the mobile chrome sheet up to dismiss
    Then the mobile chrome sheet should not be visible
    And there should be no page errors
