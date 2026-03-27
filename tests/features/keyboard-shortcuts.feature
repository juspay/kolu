Feature: Keyboard Shortcuts
  Global keyboard shortcuts for terminal switching and help overlay.

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

  Scenario: Ctrl+Tab opens Mission Control for quick switch
    When I open the app
    And I create a terminal
    And I run "echo tab-second"
    And I create a terminal
    And I run "echo tab-third"
    # Ctrl+Tab opens Mission Control
    When I hold Ctrl and press Tab
    Then Mission Control should be visible
    # Tab advances focus, release Ctrl selects
    When I press Tab
    When I release Ctrl
    Then Mission Control should not be visible
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
