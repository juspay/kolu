@omp-mock
Feature: Oh My Pi status detection
  When the oh-my-pi coding agent (`omp`) is running in a terminal, the canvas
  tile chrome shows its current state (thinking, tool use, awaiting you —
  the approval / `ask` dialog it paints on screen — and waiting).

  Requires KOLU_OMP_DIR to point at a test-controlled directory and a fake
  `omp` binary (bash copy) so the foreground-basename check passes without a
  real omp install. Both are seeded by hooks.ts.

  Detection is anchored on omp's own per-terminal BREADCRUMB
  (`<agent dir>/terminal-sessions/<tty>`), so the fake binary writes its own
  crumb from its own tty — the same thunk real omp uses.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome lights up for an Oh My Pi session and follows a live state transition
    When an Oh My Pi session is mocked with state "thinking"
    Then the tile chrome should show an Oh My Pi indicator with state "thinking"
    When the Oh My Pi session state changes to "tool_use"
    Then the tile chrome should follow the Oh My Pi state change to "tool_use" without nudging
    When the Oh My Pi session state changes to "waiting"
    Then the tile chrome should follow the Oh My Pi state change to "waiting" without nudging
    And there should be no page errors

  # Real omp writes its breadcrumb at launch — marked `fresh` while the session
  # is still memory-only — so the preexec hint fires while the crumb's target
  # does not exist yet. Detection binds the session from the crumb alone, and
  # the append watcher's absent→present floor is then the only thing that can
  # light the tile when the file lands, long after the reconcile ladder stopped.
  Scenario: Tile chrome lights up when the session file lands after the reconcile ladder
    When an Oh My Pi process is running with no session file yet
    And 1500 ms elapse past the command-run reconcile window
    And a session file is written for the running Oh My Pi process with state "thinking"
    Then the tile chrome should show an Oh My Pi indicator with state "thinking"
    And there should be no page errors

  Scenario: An approval dialog on screen promotes tool use to awaiting (screen scrape)
    # The approval gate is omp's own dialog (`Allow tool: …`), painted while the
    # tool call sits on disk — so the transcript reads `tool_use` throughout the
    # wait. kolu recognizes the dialog's box title on the rendered screen and
    # promotes to awaiting_user; when it clears, the dock drops back to the
    # transcript's own state with no file change.
    When an Oh My Pi session is mocked with state "tool_use"
    Then the tile chrome should show an Oh My Pi indicator with state "tool_use"
    When Oh My Pi renders a tool approval prompt
    Then the tile chrome should show an Oh My Pi indicator with state "awaiting_user"
    When Oh My Pi clears its prompt from the screen
    Then the tile chrome should follow the Oh My Pi state change to "tool_use" without nudging
    And there should be no page errors
