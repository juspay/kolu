Feature: Compact two-pane layout
  On a roomy touch device — a Z Fold 6 unfolded, a tablet — kolu mounts a
  two-pane layout: a persistent dock rail beside the active terminal, in
  place of the phone's swipe drawer or the desktop's mouse-driven pan/zoom
  canvas. The rail is always visible; tapping a row switches the active
  terminal. The @compact tag emulates a ~900×1000 near-square touch viewport
  (past the `sm` breakpoint, coarse pointer), so `layoutMode` resolves to
  `compact` rather than `phone` or `desktop`.

  @compact
  Scenario: A roomy touch viewport mounts the two-pane compact layout
    # Regression cover for the original bug: a Z Fold 6 unfolded (~900px,
    # touch-only) used to cross the width-only breakpoint and render the full
    # desktop canvas + ChromeBar. It must now get the compact rail instead.
    Given the terminal is ready
    Then the compact dock rail should be visible
    And the mobile tile view should be visible
    And the desktop chrome bar should not be present
    And the mobile dock handle should not be present
    And there should be no page errors

  @compact
  Scenario: Tapping a rail row switches the active terminal
    Given the terminal is ready
    And I run "echo from-t0"
    And I create a terminal
    When I tap the inactive mobile dock row
    Then the active terminal should show "from-t0"
    And the compact dock rail should be visible
    And there should be no page errors

  @compact
  Scenario: An empty compact workspace offers a tappable create path
    # The desktop Dock's `+` was the only clickable create on a >=sm touch
    # viewport before the layoutMode split — `isDesktop()` is now false there,
    # so the Dock is gone. EmptyState must carry its own tap-to-create button,
    # or a finger-only foldable has no way to the first terminal.
    When I open the app
    Then the empty state create button should be visible
    And the desktop dock should not be present
    When I tap the empty state create button
    Then the command palette should be visible
    And there should be no page errors
