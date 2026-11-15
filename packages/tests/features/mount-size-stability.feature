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

  # A — one tile, one open split, the divider where it opens by default.
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

  # B — the same, with the divider moved off its default first. The drag is
  # both the arrange and this scenario's control: the dragged size is saved on
  # the record, and a mount that laid the tile out from anything else would
  # state a height the program can see.
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
    # The programs were told nothing, so the divider is exactly where it was:
    # the main pane's rows ARE the divider's position.
    And the split should still be open
    And the size record should be reported as "B: dragged divider, 15 mounts"
    And there should be no page errors

  # C — the split collapsed. Two claims: the collapse survives (it used to be
  # written away by the very first mount), and the main pane is never told the
  # default 70/30 height a collapsed tile does not have.
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

  # D — two plain tiles, no split anywhere. The control: if A or B bounces and
  # this does not, the split is the input; if this bounces too, the tile's own
  # layout is.
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

  # E — a new terminal must not resize the ones already there, and must itself
  # be told its size once. The record for the NEW terminal starts where its
  # recorder could first be started, so the claim about it is about the
  # distinct sizes it ever had (its spawn grid, then its box) rather than
  # about entries; the claim about the terminal that was already there is
  # exact.
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
    # A REMOUNT is invisible to every size assertion above: a rebuilt pane comes
    # back at the size it already had and tells its program nothing, having
    # thrown away the reader's scroll position, selection and focus on the way.
    And every marked pane should be the same element, with no second attach
    And the new terminal's program was told at most one new size, ending at its pane's grid
    And the size record should be reported as "E: a second terminal appears"
    And there should be no page errors

  # E2 — the same question down the PRODUCT's own create path (⌘⏎), from a
  # tile the user has resized: the new tile then inherits that size
  # (`usePendingLayouts.takeNextDefaultSize`) instead of opening at the canvas
  # default. Production saw a new terminal told two widths ~240 ms apart and
  # CI did not; a remembered size is the first thing production had that the
  # measurement lacked.
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

  # E3 — created while the canvas is MAXIMIZED. The new tile opens covered or
  # maximized rather than tiled, which is a different box decision again.
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

  # E4 — created with the right panel open and the dock collapsed to its rail:
  # the two other things that take width out of the window, and the two states
  # production is usually in.
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

  # F — maximize covers the other tiles. A covered tile is held attached for
  # an hour (kolu#2374) so a trip away and back keeps the reader's place;
  # that is a different fact from "may state a size", and this is where they
  # used to be one.
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
    # A covered tile is HELD, not rebuilt: the trip is a repaint, so the reader
    # comes back to the place they were reading.
    And every marked pane should be the same element, with no second attach
    And the size record should be reported as "F: maximize over a sibling"
    And there should be no page errors

  # G — the whole list for a posture trip, stated exactly. The tile you look
  # at is told the size you are looking at it at, once, each time; the tile
  # you are not looking at is told nothing until it is on screen at a size of
  # its own again.
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
    # Every tile was resized, and NO tile was rebuilt: a posture is a change of
    # box, never a change of element.
    And every marked pane should be the same element, with no second attach
    And the size record should be reported as "G: maximize, switch, restore"
    And there should be no page errors

  # H — a split is the one thing that really does move the main pane's box.
  # Opening one takes its share; collapsing it gives the share back. One size
  # each way, and no second one correcting a first.
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
