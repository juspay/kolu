Feature: A program is told a new size only when its box moved
  A terminal's program is told a new size by SIGWINCH each time kolu resizes
  its PTY, and it redraws — a full repaint, and for an agent a reflow of
  everything on screen. That must happen only when the terminal's box really
  changed. Three field observations say it sometimes happens when it did not:
  a height bounce at a host mount (44 → 63 → 44 rows, 257 ms apart), a brand
  new terminal told two sizes 242 ms apart, and maximizing one tile resizing
  the tiles behind it.

  This feature is a MEASUREMENT, not a guard: each scenario states the exact
  list of sizes each program was told, and a red one is a finding rather than
  a regression. The instrument is a stand-in program in the real PTY that
  writes down the size it has at start and on every SIGWINCH, read back
  through the daemon's own mirror so the pane under measurement is never also
  the measuring instrument (`support/winsizeRecorder.ts`).

  Three things make a GREEN here mean something:

    · @retina — a fractional device pixel ratio (2.25), where a cell's width
      is fractional and two measurements of the same box taken a frame apart
      can disagree. At the harness default of 1 a sizing scenario can pass by
      accident (`support/hooks.ts`).
    · the hold. "Told no new size" is a claim about a ROUND TRIP — a 250 ms
      publish settle, kaval's 600 ms resize window, and the trip itself — so
      every negative is held for three seconds and sampled four times a
      second throughout, never read once and believed.
    · the positive control. Every scenario moves the box DELIBERATELY while
      the recorders are running and proves that change was recorded, before
      it claims that something else changed nothing. An instrument that
      reports nothing at all would otherwise read as a clean bill of health.

  Each scenario also prints its record, so a green run still carries the
  numbers (`[mount-size]` in the lane log).

  Background:
    Given the terminal is ready

  # A — the plain shape the field observation was seen in: one tile, one open
  # split. Fifteen mounts, because the bounce was seen once in dozens.
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
    And the size record should be reported as "A: split, 15 mounts"
    And there should be no page errors

  # B — the same, with the divider moved off its default first. The drag is
  # both the arrange and this scenario's control: a persisted panel size that
  # arrives after the first measurement would move the box the same way on
  # every mount.
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
    And the size record should be reported as "B: dragged divider, 15 mounts"
    And there should be no page errors

  # C — the split collapsed. The main pane then owns the whole tile, which is
  # also what a tile that has not yet learned it has a split looks like: if
  # the child's record is the late input, a collapsed tile is the one shape
  # that must NOT bounce. The collapse is the control; only the main pane is
  # claimed about, because a hidden pane is not shown and states nothing.
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
    And I create another terminal and start a size recorder in it
    And I wait out the settle window
    Then every program that was already running was told no new size
    And the new terminal's program was told at most one new size, ending at its pane's grid
    And the size record should be reported as "E: a second terminal appears"
    And there should be no page errors

  # F — maximize covers the other tiles. A covered tile is given the full
  # viewport box and still counts as seen for five minutes (kolu#2374), so it
  # can measure that box and state it. The un-maximize is included because the
  # round trip is what the user feels: a tile they never looked at repainting
  # twice.
  @retina
  Scenario: One tile is maximized over another and restored
    Given I create a terminal
    When a size recorder is running in every pane on screen
    And every recorded program has settled
    And I narrow every recorded tile by 120 pixels
    Then every recorded program was told a new size
    When every recorded program has settled
    And I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    When I wait out the settle window
    And I double-click the title bar of canvas tile 1
    Then no canvas tile should be maximized
    And the program in canvas tile 2 was told no new size
    And the size record should be reported as "F: maximize over a sibling"
    And there should be no page errors
