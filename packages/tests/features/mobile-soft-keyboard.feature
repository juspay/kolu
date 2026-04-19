Feature: Mobile soft keyboard
  `MobileKeyBar` is the only path on a touch device for keys the on-screen
  keyboard can't reliably send: Esc, Tab, arrows, Ctrl-C, slash, Enter.
  Each button writes its escape sequence directly to the PTY via
  `client.terminal.sendInput`, bypassing xterm's keyboard layer entirely
  — so the round-trip we want to assert is button → server → shell echo.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Soft key bar is visible on mobile
    Then the mobile soft key bar should be visible
    And there should be no page errors

  @mobile
  Scenario: Tapping the slash key sends slashes to the active terminal
    When I tap the mobile key "slash"
    And I tap the mobile key "slash"
    And I tap the mobile key "slash"
    Then the active terminal should show "///"
    And there should be no page errors

  @mobile
  Scenario: Tapping Ctrl-C interrupts a running command
    Given I run "sleep 30"
    When I tap the mobile key "ctrl-c"
    Then the active terminal should show "^C"
    And there should be no page errors

  @mobile
  Scenario: Tapping ↑ then ⏎ recalls and resubmits the previous command
    Given I run "echo soft-recall-marker"
    When I tap the mobile key "up"
    And I tap the mobile key "enter"
    Then the active terminal should show "soft-recall-marker" 3 times
    And there should be no page errors
