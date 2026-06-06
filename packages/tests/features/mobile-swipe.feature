Feature: Mobile tile swipe
  On mobile the canvas is disabled. The active terminal fills the viewport
  and swipe-left/right cycles between terminals in workspace-switcher order.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Mobile renders one fullscreen tile
    Then the mobile tile view should be visible
    And there should be no page errors

  @mobile
  Scenario: Swipe left cycles to a different terminal
    # Background creates t0; explicit create makes t1 active. Swipe left
    # advances in workspace-switcher order — with two terminals it lands on t0,
    # whose buffer is empty (no echo issued).
    Given I run "echo from-t0"
    And I create a terminal
    When I swipe left on the mobile tile view
    Then the active terminal should show "from-t0"
    And there should be no page errors

  @mobile
  Scenario: Swipe right also cycles
    Given I run "echo from-t0"
    And I create a terminal
    When I swipe right on the mobile tile view
    Then the active terminal should show "from-t0"
    And there should be no page errors

  @mobile
  Scenario: Swiping on the soft key bar does not cycle terminals
    # The key bar lives inside the swipe wrapper. A finger drag across the
    # keys must NOT bubble up and switch terminals mid-type — the bar stops
    # touchstart propagation. Contrast with
    # the tile-view scenario above, where the same leftward swipe cycles the
    # tile; here the active terminal must be unchanged.
    Given I run "echo from-t0"
    And I create a terminal
    And I remember the active mobile terminal
    When I swipe left on the mobile key bar
    Then the active mobile terminal should be unchanged
    And there should be no page errors
