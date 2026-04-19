Feature: Mobile sub-terminals
  Sub-terminals (per-tile splits) live inside `TerminalContent`, which
  mobile mounts via `MobileTileView.renderBody`. They're reachable on
  mobile via the same Toggle-terminal-split palette command as on desktop
  — verifying the wiring works under the mobile viewport guards mobile
  users from regressions in the split feature.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Create sub-terminal via command palette on mobile
    When I create a sub-terminal via command palette
    Then the sub-panel should be visible
    And the sub-terminal should have keyboard focus
    And there should be no page errors

  @mobile
  Scenario: Sub-terminal output persists across mobile tile swipe
    When I create a sub-terminal via command palette
    And I run "echo mobile-sub-marker" in the sub-terminal
    And I create a terminal
    And I swipe left on the mobile tile view
    Then the sub-terminal screen should contain "mobile-sub-marker"
    And there should be no page errors
