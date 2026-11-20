Feature: Per-terminal viewport grid
  Each terminal owns its own cols×rows. Fitting one terminal must not
  propagate cols to another terminal. This guards against the old shared
  `viewportDimensions` signal that let a narrow mobile active terminal
  drag every hidden terminal's xterm and PTY grid along with it — so
  rotating, resizing, or opening the soft keyboard on one terminal
  silently re-sized every other terminal on the page.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Resizing the active mobile terminal does not resize hidden terminals
    Given I create a terminal
    When I swipe left on the mobile tile view
    And I wait for all terminals to settle
    And I snapshot each terminal's cols
    When I resize the viewport to 620x844
    And I wait for the active terminal's grid to come back from the daemon
    Then the active terminal cols should differ from its snapshot
    And the hidden terminal cols should match its snapshot
    And there should be no page errors
