Feature: Mobile host row
  On the touch layout the persistent desktop chrome bar (and its
  `HostSelectorStrip`) is gone, so hosts live in a row at the top of the
  pull-down chrome sheet (`MobileHostRow`). Each pool host is a ≥44px chip
  carrying the desktop vocabulary — connection dot, identity hue, attention
  pill — and a tap switches the active host. The `+` opens an in-sheet
  add-host section (the mobile-native variant of the desktop popover).

  Multi-host switching and the attention pill need a second connected host,
  which the e2e env can't provision over ssh; those are covered by the PR's
  live chrome-devtools evidence. Here we cover the always-present local host
  surface: the row renders, the chip is legible, and the add section opens.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: The host row renders in the pull-down sheet with the local chip
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    And the mobile host row should be visible
    And the local host chip should be visible and active
    And there should be no page errors

  @mobile
  Scenario: Tapping the already-active local chip is a no-op without errors
    When I tap the mobile pull handle
    Then the mobile host row should be visible
    When I tap the local host chip
    # A tap on the ALREADY-active chip is not a switch, so it must leave the
    # sheet open (the chip stays visible and active) rather than dismissing it.
    Then the mobile chrome sheet should be visible
    And the local host chip should be visible and active
    And there should be no page errors

  @mobile
  Scenario: The add-host affordance opens an in-sheet add section
    When I tap the mobile pull handle
    Then the mobile host row should be visible
    When I tap the mobile add-host affordance
    Then the mobile add-host section should be visible
    And there should be no page errors

  @mobile
  Scenario: The host row stays reachable when the canvas isn't a workspace
    # Regression: the pull-down chrome (and with it the host row) used to live
    # INSIDE the workspace tile view, so any non-workspace canvas — a
    # connecting/warming host, a down host, or zero terminals — dropped the
    # pull-handle and stranded the user with no way to switch hosts. The chrome
    # now lives above the canvas Switch (`MobilePullChrome`), present in every
    # mode. Reaching the empty (zero-terminal) canvas is the e2e-reachable proxy
    # for that whole class; the host-down/connecting cases share the code path.
    When I close the active terminal via command palette
    Then the empty state tip should be visible
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    And the mobile host row should be visible
    And there should be no page errors
