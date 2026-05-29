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
  Scenario: Sticky Ctrl folds into the next character typed on the soft keyboard
    # Soft keyboards can't send Ctrl chords. The key bar arms a sticky Ctrl;
    # the next character typed (xterm onData) is folded into the chord — here
    # "c" becomes 0x03 and interrupts the running command. Exercises the
    # onData fold, which the key bar's own sendInput path can't reach.
    Given I run "sleep 30"
    When I tap the mobile key "ctrl"
    Then the mobile key "ctrl" should be armed
    When I type "c" on the soft keyboard
    Then the active terminal should show "^C"
    And the mobile key "ctrl" should not be armed
    And there should be no page errors

  @mobile
  Scenario: An armed sticky modifier is consumed one-shot by the next key-bar key
    # Arming Ctrl then tapping a key-bar key routes through the same fold.
    # "/" has no control byte so it passes through unchanged, but the modifier
    # still disarms — a stray arm never lingers onto a later keystroke.
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
    # Regression guard for the iOS focus-shuffle bug (#448 / Terminal.tsx
    # pointerdown fix): .xterm-screen must never receive a focus event during
    # the tap — that's the smoking gun for the shuffle iOS uses to reject the
    # soft keyboard.
    When I tap the terminal canvas
    Then the xterm contenteditable screen should never have been focused
    And xterm's helper textarea should be the active element
    And there should be no page errors

  @mobile
  Scenario: Touch-scrolling the terminal does not summon the soft keyboard
    # The pointerdown→focus pattern that unstuck the iOS keyboard would also
    # fire at scroll-start — every swipe popped the keyboard mid-read. Defer
    # the focus call to pointerup, gated on a tap-sized movement threshold:
    # taps still summon the keyboard; scrolls don't.
    When I touch-scroll inside the terminal canvas
    Then xterm's helper textarea should not have been focused by the scroll
    And there should be no page errors

  @mobile
  Scenario: A canceled gesture clears state so a trailing pointerup does not focus
    # The pointercancel branch in the tap handler clears activeTap so a
    # later pointerup (system-cancelled gesture, browser-glitch sequence)
    # can't slip through and focus the textarea on its way past — popping
    # the soft keyboard with nothing behind it.
    When I cancel a pointer gesture on the terminal canvas mid-tap
    Then xterm's helper textarea should not have been focused by the canceled gesture
    And there should be no page errors

  @mobile
  Scenario: Switching terminals does not summon the soft keyboard
    # Selection ≠ keyboard focus on touch. Switching the active tile flips
    # which Terminal is visible/focused, but the reactive focus effects
    # (visibility, focused-prop) are gated behind focusOnSelection()'s !isTouch()
    # check — so they must NOT focus xterm's helper textarea on a touch
    # device. A focus there pops the soft keyboard with no tap from the user.
    # Only the explicit tap handlers focus on touch.
    Given I create a terminal
    And I arm the soft-keyboard focus probe
    When I swipe left on the mobile tile view
    Then xterm's helper textarea should not have been focused by the terminal switch
    And there should be no page errors

  @mobile
  Scenario: App root tracks visualViewport.height so the keyboard doesn't overlap the terminal
    # iOS Safari overlays the soft keyboard on top of the layout viewport;
    # `100dvh` doesn't shrink. useVisualViewportHeight sets `--app-h` on
    # <html> so `var(--app-h, 100dvh)` on the App root tracks the visible
    # area. Wire-check: --app-h must be populated after mount.
    Then the --app-h CSS variable should match visualViewport.height
    And there should be no page errors
