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
    # On touch the new sub-terminal does NOT grab keyboard focus — the soft
    # keyboard rises only on an explicit tap (focus-on-create auto-focus is
    # desktop-only, covered in sub-terminal.feature). Here we just verify the
    # palette-create wiring works under the mobile viewport.
    When I create a sub-terminal via command palette
    Then the sub-panel should be visible
    And there should be no page errors

  @mobile
  Scenario: Sub-terminal output persists across mobile tile swipe
    When I create a sub-terminal via command palette
    And I run "echo mobile-sub-marker" in the sub-terminal
    And I create a terminal
    And I swipe left on the mobile tile view
    Then the sub-terminal screen should contain "mobile-sub-marker"
    And there should be no page errors

  @mobile
  Scenario: Active pane is distinguished in a split on mobile
    # Same recede cue as desktop, under the mobile viewport: the pane without
    # focus dims. Fill both panes so the recede reads on real output.
    When I create a sub-terminal via command palette
    And I run "ls -la /" in the sub-terminal
    And I run "ls -la /usr"
    Then the main pane should be the active pane
    And the sub pane should be receded
    And there should be no page errors
