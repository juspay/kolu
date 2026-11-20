@omp-mock
Feature: Oh My Pi status detection
  When the oh-my-pi coding agent (`omp`) is running in a terminal, the canvas
  tile chrome shows its current state (thinking, tool use, awaiting you —
  the approval / `ask` dialog it paints on screen — and waiting), and how far
  through its todo list it is.

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

  Scenario: Tile chrome and the inspector show how far through its todo list Oh My Pi is
    When an Oh My Pi session is mocked with state "tool_use"
    Then the tile chrome should show an Oh My Pi indicator with state "tool_use"
    When Oh My Pi's todo list has 5 tasks with 3 done
    Then the tile chrome should show task progress "3/5"
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the inspector agent card should contain "3/5 tasks"
    And there should be no page errors

  Scenario: Tile chrome lights up when the session file lands after the reconcile ladder
    When an Oh My Pi process is running with no session file yet
    And 1500 ms elapse past the command-run reconcile window
    And a session file is written for the running Oh My Pi process with state "thinking"
    Then the tile chrome should show an Oh My Pi indicator with state "thinking"
    And there should be no page errors

  Scenario: An approval dialog on screen promotes tool use to awaiting (screen scrape)
    When an Oh My Pi session is mocked with state "tool_use"
    Then the tile chrome should show an Oh My Pi indicator with state "tool_use"
    When Oh My Pi renders a tool approval prompt
    Then the tile chrome should show an Oh My Pi indicator with state "awaiting_user"
    When Oh My Pi clears its prompt from the screen
    Then the tile chrome should follow the Oh My Pi state change to "tool_use" without nudging
    And there should be no page errors
