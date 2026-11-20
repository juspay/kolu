Feature: A program is told a new size only when its box moved
  A terminal's program is told a new size by SIGWINCH each time kolu resizes
  its PTY, and it redraws — a full repaint, and for an agent a reflow of
  everything on screen. That must happen only when the terminal's box really
  changed.

  Three things used to break that, all measured here before they were fixed
  (kolu#2362, kolu#2372):

    · a tile with a split laid itself out from a browser-side COPY of the
      split's state that answered defaults until a restore filled it in, so
      every mount stated the wrong height and corrected it 250 ms later;
    · that same mount persisted the default it had just laid out, so the first
      mount after a user collapsed a split wrote the collapse away;
    · a tile parked behind a maximized one was given the maximized tile's box
      and stated it, resizing a terminal nobody was looking at.

  The instrument is a stand-in program in the real PTY that writes down the
  size it has at start and on every SIGWINCH, read back through the daemon's
  own mirror so the pane under measurement is never also the measuring
  instrument (`support/winsizeRecorder.ts`).

  Three things make a GREEN here mean something:

    · @retina — a fractional device pixel ratio (2.25), where a cell's width
      is fractional and two measurements of one box can disagree. At the
      harness default of 1 a sizing scenario can pass by accident
      (`support/hooks.ts`).
    · the hold. "Told no new size" is a claim about a ROUND TRIP — a 250 ms
      publish settle, kaval's 600 ms resize window, and the trip itself — so
      every negative is watched for three seconds, sampled four times a
      second, to the END of the window (a bounce reads as the two sizes it
      is, never as half of one).
    · the positive control. Every scenario moves a box DELIBERATELY while the
      recorders are running and proves that change was recorded, before it
      claims that something else changed nothing. An instrument that reports
      nothing at all would otherwise read as a clean bill of health.

  Each reload scenario also prints its record, one line per mount, and fails
  if any mount sent a `chrome.setSubPanel` — a mount may not write the split's
  state at all.

  Background:
    Given the terminal is ready

  @retina
  Scenario: A tile with an open split is remounted fifteen times
    When I create a sub-terminal via command palette
    And a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I reload the page 15 times
    Then no recorded program was told a new size
    And the split should still be open
    And the size record should be reported as "A: split, 15 mounts"
    And there should be no page errors

  @retina
  Scenario: A tile whose divider was dragged is remounted fifteen times
    When I create a sub-terminal via command palette
    And a size recorder is running in every pane on screen
    And every recorded program has settled
    And I drag the split divider up by 80 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I reload the page 15 times
    Then no recorded program was told a new size
    And the split should still be open
    And the size record should be reported as "B: dragged divider, 15 mounts"
    And there should be no page errors

  @retina
  Scenario: A tile whose split was collapsed is remounted fifteen times
    When I create a sub-terminal via command palette
    And a size recorder is running in every pane on screen
    And every recorded program has settled
    And I toggle the sub-panel via command palette
    Then the program in the main pane was told a new size
    When every recorded program has settled
    And I reload the page 15 times
    Then the program in the main pane was told no new size
    And the split should still be collapsed
    And the size record should be reported as "C: collapsed split, 15 mounts"
    And there should be no page errors

  @retina
  Scenario: Two tiles are remounted fifteen times
    Given I create a terminal
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I reload the page 15 times
    Then no recorded program was told a new size
    And the size record should be reported as "D: two tiles, 15 mounts"
    And there should be no page errors

  @retina
  Scenario: A second terminal appears beside a settled one
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I mark every recorded pane
    And I create another terminal and start a size recorder in it
    And I wait out the settle window
    Then every program that was already running was told no new size
    And every marked pane should be the same element, with no second attach
    And the new terminal's program was told at most one new size, ending at its pane's grid
    And the size record should be reported as "E: a second terminal appears"
    And there should be no page errors

  @retina
  Scenario: A second terminal is created with the keyboard from a resized tile
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I mark every recorded pane
    And I create another terminal with the keyboard and start a size recorder in it
    And I wait out the settle window
    Then every program that was already running was told no new size
    And every marked pane should be the same element, with no second attach
    And the new terminal's program was told at most one new size, ending at its pane's grid
    And the size record should be reported as "E2: keyboard create, inherited size"
    And there should be no page errors

  @retina
  Scenario: A second terminal is created while the canvas is maximized
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I click the chrome-bar maximize toggle
    Then canvas tile 1 should be maximized
    When every recorded program has settled
    And I mark every recorded pane
    And I create another terminal with the keyboard and start a size recorder in it
    And I wait out the settle window
    Then every program that was already running was told no new size
    And every marked pane should be the same element, with no second attach
    And the size record should be reported as "E3: created while maximized"
    And there should be no page errors

  @retina
  Scenario: A second terminal is created with the inspector open and the dock railed
    When I press the toggle inspector shortcut
    And I collapse the dock to rail
    And a size recorder is running in every pane on screen
    And every recorded program has settled
    And I mark every recorded pane
    And I create another terminal with the keyboard and start a size recorder in it
    And I wait out the settle window
    Then every program that was already running was told no new size
    And every marked pane should be the same element, with no second attach
    And the new terminal's program was told at most one new size, ending at its pane's grid
    And the size record should be reported as "E4: inspector open, dock railed"
    And there should be no page errors

  @retina
  Scenario: One tile is maximized over another and restored
    Given I create a terminal
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I mark every recorded pane
    And I double-click the title bar of canvas tile 1
    Then some canvas tile should be maximized
    And the covered tile's program was told no new size
    When I wait out the settle window
    And I click the chrome-bar maximize toggle
    Then no canvas tile should be maximized
    And the tile that was covered was told no new size
    And every marked pane should be the same element, with no second attach
    And the size record should be reported as "F: maximize over a sibling"
    And there should be no page errors

  @retina
  Scenario: Maximizing, switching which tile is maximized, and restoring
    Given I create a terminal
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I mark every recorded pane
    And I double-click the title bar of canvas tile 1
    Then some canvas tile should be maximized
    And the maximized tile's program was told exactly 1 new size
    And the covered tile's program was told no new size
    When I press Control+Tab
    Then a different canvas tile should be maximized
    And the maximized tile's program was told exactly 1 new size
    And the covered tile's program was told no new size
    When I click the chrome-bar maximize toggle
    Then no canvas tile should be maximized
    And every recorded program was told exactly 1 new size
    And every marked pane should be the same element, with no second attach
    And the size record should be reported as "G: maximize, switch, restore"
    And there should be no page errors

  @retina
  Scenario: Adding a split and collapsing it each tell the main program once
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I create a sub-terminal via command palette
    Then the program in the main pane was told exactly 1 new size
    When I toggle the sub-panel via command palette
    Then the program in the main pane was told exactly 1 new size
    And the split should still be collapsed
    And the size record should be reported as "H: split added, then collapsed"
    And there should be no page errors
