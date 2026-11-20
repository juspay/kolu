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
  Scenario: The soft key bar lays its keys out in two rows without horizontal scroll
    Then the mobile soft key bar should be visible
    And the mobile soft key bar should not scroll horizontally
    And the mobile soft key bar keys should occupy two rows
    And there should be no page errors

  @mobile
  Scenario: Tapping the slash key sends slashes to the active terminal
    When I tap the mobile key "slash"
    And I tap the mobile key "slash"
    And I tap the mobile key "slash"
    Then the active terminal should show "///"
    And there should be no page errors

  @mobile
  Scenario: Key-bar keys route to the focused split, not the parent tile
    When I create a sub-terminal via command palette
    And I tap the mobile key "slash"
    And I tap the mobile key "slash"
    And I tap the mobile key "slash"
    Then the sub-terminal screen should contain "///"
    And there should be no page errors

  @mobile
  Scenario: Tapping Ctrl-C interrupts a running command
    Given I start "sleep 30"
    When I tap the mobile key "ctrl-c"
    Then the active terminal should show "^C"
    And there should be no page errors

  @mobile
  Scenario: Sticky Ctrl folds into the next character typed on the soft keyboard
    Given I start "sleep 30"
    When I tap the mobile key "ctrl"
    Then the mobile key "ctrl" should be armed
    When I type "c" on the soft keyboard
    Then the active terminal should show "^C"
    And the mobile key "ctrl" should not be armed
    And there should be no page errors

  @mobile
  Scenario: An armed sticky modifier is consumed one-shot by the next key-bar key
    When I tap the mobile key "ctrl"
    And I tap the mobile key "slash"
    Then the active terminal should show "/"
    And the mobile key "ctrl" should not be armed
    And there should be no page errors

  @mobile
  Scenario: Tapping ↑ then ⏎ recalls and resubmits the previous command
    Given I run "echo soft-recall-marker"
    When I tap the mobile key "up"
    And I tap the mobile key "enter"
    Then the active terminal should show "soft-recall-marker" 3 times
    And there should be no page errors

  @mobile
  Scenario: Tapping the terminal focuses xterm without a contenteditable focus shuffle
    When I tap the terminal canvas
    Then the xterm contenteditable screen should never have been focused
    And xterm's helper textarea should be the active element
    And there should be no page errors

  @mobile
  Scenario: Touch-scrolling the terminal does not summon the soft keyboard
    When I touch-scroll inside the terminal canvas
    Then xterm's helper textarea should not have been focused by the scroll
    And there should be no page errors

  @mobile
  Scenario: A canceled gesture clears state so a trailing pointerup does not focus
    When I cancel a pointer gesture on the terminal canvas mid-tap
    Then xterm's helper textarea should not have been focused by the canceled gesture
    And there should be no page errors

  @mobile
  Scenario: Switching terminals does not summon the soft keyboard
    Given I create a terminal
    And I arm the soft-keyboard focus probe
    When I swipe left on the mobile tile view
    Then xterm's helper textarea should not have been focused by the terminal switch
    And there should be no page errors

  @mobile
  Scenario: Catching up via the scroll-to-bottom FAB does not summon the soft keyboard
    When I run "seq 1 200"
    And I note the terminal viewport scroll position
    And I swipe down inside the terminal viewport
    Then the scroll-to-bottom button should be visible
    When I arm the soft-keyboard focus probe
    And I tap the scroll-to-bottom button
    Then xterm's helper textarea should not have been focused by scrolling to the bottom
    And there should be no page errors

  @mobile
  Scenario: Closing a dialog does not summon the soft keyboard
    When I arm the soft-keyboard focus probe
    And I open the command palette
    Then the command palette should be visible
    When I press Escape
    Then the command palette should not be visible
    And xterm's helper textarea should not have been focused by closing the dialog
    And there should be no page errors

  @mobile
  Scenario: App root tracks visualViewport.height so the keyboard doesn't overlap the terminal
    Then the --app-h CSS variable should match visualViewport.height
    And there should be no page errors
