@layout-compact
Feature: Keyboard Shortcuts
  Global keyboard shortcuts for terminal switching and help overlay.
  Pinned compact so sidebar-related selectors resolve at 1280×720.

  Background:
    Given the terminal is ready

  Scenario: Open and close shortcuts help with keyboard
    When I press the shortcuts help shortcut
    Then the shortcuts help should be visible
    When I press Escape
    Then the shortcuts help should not be visible
    And there should be no page errors

  Scenario: Toggle shortcuts help with shortcut key
    When I press the shortcuts help shortcut
    Then the shortcuts help should be visible
    When I press the shortcuts help shortcut
    Then the shortcuts help should not be visible
    And there should be no page errors

  Scenario: Close shortcuts help by clicking outside
    When I press the shortcuts help shortcut
    Then the shortcuts help should be visible
    When I click outside the shortcuts help
    Then the shortcuts help should not be visible
    And there should be no page errors

  Scenario: Switch terminal with Mod+1-9
    When I open the app
    And I create a terminal
    And I run "echo shortcut-second"
    And I create a terminal
    And I run "echo shortcut-third"
    # Switch back to terminal 2 (first explicitly created one; terminal 1 is from Background)
    When I press the switch to terminal 2 shortcut
    Then the active terminal should show "shortcut-second"
    And there should be no page errors

  Scenario: Cycle terminals with next/prev shortcuts
    When I open the app
    And I create a terminal
    And I run "echo cycle-second"
    And I create a terminal
    And I run "echo cycle-third"
    # We're on terminal 3 (last created). Prev should go to terminal 2.
    When I press the prev terminal shortcut
    Then the active terminal should show "cycle-second"
    # Next should go back to terminal 3.
    When I press the next terminal shortcut
    Then the active terminal should show "cycle-third"
    And there should be no page errors

  Scenario: Ctrl+Tab jumps to the most recently used terminal
    When I open the app
    And I create a terminal
    And I run "echo tab-second"
    And I create a terminal
    And I run "echo tab-third"
    # Active is terminal 3, previous-MRU is terminal 2.
    When I jump to the previous terminal
    Then the active terminal should show "tab-second"
    And there should be no page errors

  Scenario: Holding Ctrl+Tab repeatedly cycles through MRU terminals
    When I open the app
    And I create a terminal
    And I run "echo cycle-first"
    And I create a terminal
    And I run "echo cycle-second"
    And I create a terminal
    And I run "echo cycle-third"
    # MRU snapshot while Ctrl held: [cycle-third, cycle-second, cycle-first, background].
    # Pressing Tab twice advances cursor to index 2 = cycle-first.
    When I cycle 2 terminals back by holding Ctrl+Tab
    Then the active terminal should show "cycle-first"
    And there should be no page errors

  Scenario: Create terminal with shortcut
    Given I note the sidebar entry count
    When I press the create terminal shortcut
    Then the sidebar should have 1 more terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Shortcuts do not leak keystrokes to terminal
    Given I intercept oRPC sendInput calls
    When I press the shortcuts help shortcut
    And I press Escape
    Then no sendInput call should contain "/"
    And there should be no page errors
