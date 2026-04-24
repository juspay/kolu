Feature: Session restore
  Terminals and their CWDs are saved automatically. When kolu starts
  with no terminals, the empty state offers to restore the previous session.

  Scenario: Restore previous session from empty state
    # Seed a known session on the server (no timing dependency on auto-save)
    Given a saved session with 2 terminals
    When I open the app
    Then the session restore card should be visible
    And the restore button should mention "2 terminals"
    When I click the restore button
    Then there should be 2 pill tree entries
    And there should be no page errors

  Scenario: Restored terminals preserve their saved array order
    Given a saved session in a specific order
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 3 pill tree entries
    And the pill tree entries should be in the saved order
    And there should be no page errors

  Scenario: Restored terminals preserve their theme
    Given a saved session with theme "Dracula"
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 1 pill tree entries
    And the header should show theme "Dracula"
    And there should be no page errors

  # Regression for #642: a saved canvas layout must survive session restore.
  # The client used to race the canvas's cascade-default effect against a
  # post-hoc setCanvasLayout RPC and lose — terminals ended up in the
  # default cascade instead of their saved positions.
  Scenario: Restored terminals preserve their canvas layout
    Given a saved session with canvas layout at x=420 y=180 w=640 h=360
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 1 pill tree entries
    And the canvas tile should be at x=420 y=180 w=640 h=360
    And there should be no page errors

  Scenario: Active terminal persists across refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I select terminal 2 in the pill tree
    And I wait for the session auto-save
    And I reload the page and wait for ready
    Then pill tree entry 2 should be active
    And there should be no page errors

  # Captured agent commands (persisted on each SavedTerminal's `lastAgentCommand`)
  # surface as a "resume M agents" suffix on the restore button, with each
  # command shown beneath its terminal. A single "Resume agent sessions" toggle
  # (default on) controls whether the agents are re-run at all — turning it off
  # hides the CLI lines and drops the suffix.
  Scenario: Restore card surfaces agent commands behind a global resume toggle
    Given a saved session with 2 terminals
    And terminal 0 has captured agent command "claude --model sonnet"
    And terminal 1 has captured agent command "codex --yolo"
    When I open the app
    Then the session restore card should be visible
    And the restore card should show agent command "claude --model sonnet"
    And the restore card should show agent command "codex --yolo"
    And the restore button should mention "resume 2 agents"
    When I turn off the resume-agents toggle
    Then the restore button should not mention "resume"
    And the restore card should not show agent command "claude --model sonnet"
    And there should be no page errors

  Scenario: Plain shell terminals are grouped but carry no resume offer
    Given a saved session with 2 terminals
    When I open the app
    Then the session restore card should be visible
    And the restore button should not mention "resume"
    And there should be no page errors
