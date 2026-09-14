@pi-mock
Feature: Pi status detection
  When the pi coding agent (`pi`) is running in a terminal, the canvas tile
  chrome shows its current state (thinking, tool use, waiting).

  Requires KOLU_PI_DIR to point at a test-controlled directory and a fake
  `pi` binary (bash copy) so the foreground-basename check passes without a
  real pi install. Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome lights up for a Pi session and follows a live state transition
    When a Pi session is mocked with state "thinking"
    Then the tile chrome should show a Pi indicator with state "thinking"
    When the Pi session state changes to "tool_use"
    Then the tile chrome should follow the Pi state change to "tool_use" without nudging
    When the Pi session state changes to "waiting"
    Then the tile chrome should follow the Pi state change to "waiting" without nudging
    And there should be no page errors

  # Real pi writes its session file at launch, but the preexec hint fires
  # BEFORE the file exists, so the first reconcile ladder (0/75/300/1000ms)
  # already ran empty. Detection then depends entirely on the sessions-tree
  # externalChanges watcher firing when the file appears — a dead tree watcher
  # leaves the tile dark until the user types again. The happy-path scenario
  # writes the file inside the ladder window and so cannot catch that.
  Scenario: Tile chrome lights up when the session file lands after the reconcile ladder
    When a Pi process is running with no session file yet
    And 1500 ms elapse past the command-run reconcile window
    And a session file is written for the running Pi process with state "thinking"
    Then the tile chrome should show a Pi indicator with state "thinking"
    And there should be no page errors
