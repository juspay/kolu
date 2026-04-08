Feature: Sidebar
  Multi-terminal creation and switching via the sidebar.

  # Empty state is verified visually — requires a fresh server with no terminals.
  # Tested implicitly: waitForReady() creates a terminal only if empty state is shown.

  Scenario: Create terminal via sidebar
    When I open the app
    And I create a terminal
    Then the terminal canvas should be visible
    And the empty state tip should not be visible

  Scenario: Create second terminal and switch back
    When I open the app
    And I create a terminal
    And I run "echo first-terminal"
    And I create a terminal
    Then the terminal canvas should be visible
    When I select terminal 1 in the sidebar
    Then the active terminal should show "first-terminal"
    And there should be no page errors

  Scenario: Switching terminals auto-focuses the terminal
    When I open the app
    And I create a terminal
    And I create a terminal
    When I select terminal 1 in the sidebar
    Then the terminal should have keyboard focus

  Scenario: Switching to an off-screen terminal scrolls it into view
    # When the sidebar overflows, switching terminals via keyboard must
    # scroll the active card into view — otherwise the user has no visual
    # feedback that the switch happened. We force the overflow by clamping
    # the nav height + scrolling to bottom (rather than spawning many real
    # terminals, which would burden parallel darwin CI workers).
    When I open the app
    And I create a terminal
    And I create a terminal
    And I clamp the sidebar nav and scroll to the bottom
    When I press the switch to terminal 1 shortcut
    Then the active sidebar entry should be within the sidebar viewport

  Scenario: Creating a new terminal scrolls it into view
    # A newly created terminal becomes active. If the sidebar is already
    # overflowing, the new card can render below the fold — the user gets
    # no visual confirmation that creation succeeded. The auto-scroll
    # effect must run for the new active id, even though the entry didn't
    # exist in the DOM a moment ago.
    When I open the app
    And I create a terminal
    And I create a terminal
    And I clamp the sidebar nav and scroll to the top
    And I create a terminal
    Then the active sidebar entry should be within the sidebar viewport

  # Regression guard for #398: on cold page load, non-active terminals are
  # mounted inside display:none containers where fitAddon.fit() can't measure
  # anything, so they used to get stuck at the xterm default of 80×24 while
  # the active terminal was fit to the real viewport. The sidebar preview
  # mirrors cols×rows, so every non-active preview rendered at 80×24 — visibly
  # wrong until the user clicked each card once. Assert all terminals share
  # the same grid after refresh.
  Scenario: All terminals share grid dimensions after refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I create a terminal
    And I refresh the page
    Then all terminals should report the same grid dimensions
    And there should be no page errors

  Scenario: Terminals survive browser refresh
    When I open the app
    Given I note the sidebar entry count
    And I create a terminal
    And I create a terminal
    And I refresh the page
    Then the sidebar should have 2 more terminal entries
    And the terminal canvas should be visible
    # Run post-refresh commands to verify each terminal is alive and connected
    # to its original PTY (terminal count check above proves no new PTYs spawned).
    # We don't check pre-refresh screen content because shell SIGWINCH handlers
    # may clear the screen on resize, destroying previous output.
    When I select terminal 2 in the sidebar
    And I run "echo alive-bbb"
    Then the active terminal should show "alive-bbb"
    When I select terminal 1 in the sidebar
    And I run "echo alive-aaa"
    Then the active terminal should show "alive-aaa"
    And there should be no page errors
