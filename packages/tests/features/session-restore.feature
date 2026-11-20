Feature: Session restore
  Terminals and their CWDs are saved automatically. When kolu starts
  with no terminals, the empty state offers to restore the previous session.

  Scenario: Restore previous session from empty state
    Given a saved session with 2 terminals
    When I open the app
    Then the session restore card should be visible
    And the restore button should mention "2 terminals"
    When I click the restore button
    Then there should be 2 workspace switcher entries
    And there should be no page errors

  Scenario: Restored terminals preserve their theme
    Given a saved session with theme "Dracula"
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And the header should show theme "Dracula"
    And there should be no page errors

  Scenario: Restored terminals preserve their canvas layout
    Given a saved session with canvas layout at x=420 y=180 w=640 h=360
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And the canvas tile should be at x=420 y=180 w=640 h=360
    And there should be no page errors

  Scenario: Restored multi-tile session preserves active terminal and centers viewport
    Given a saved session with 2 tiles and the second tile marked active
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 2 workspace switcher entries
    And the active canvas tile should match the saved-session second tile
    And the active canvas tile should be centered in the viewport
    And there should be no page errors

  Scenario: Active terminal stays active AND centered across refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I create a terminal
    And I move canvas tile 1 to x=-2400 y=-1500
    And I move canvas tile 2 to x=2400 y=1500
    And I move canvas tile 3 to x=-2400 y=1500
    And I select terminal 2 in the workspace switcher
    And I save the active canvas tile id
    Then the active canvas tile should be centered in the viewport
    And the saved session should record the active terminal
    Given session.get's first yield is delayed by 500 ms to force the active-id race
    When I reload the page and wait for ready
    Then the saved active canvas tile should still be active
    And the active canvas tile should be centered in the viewport
    And there should be no page errors

  @codex-mock @kaval-restart
  Scenario Outline: A split terminal's agent resumes on session restore
    Given the terminal is ready
    When I create a sub-terminal via command palette
    And a Codex session is mocked with state "waiting" launched with the prefix "<prefix>"
    Then the saved session should list 1 resumable agents
    When the kaval daemon is killed
    Then the degraded canvas is shown
    When I restart kaval from the degraded canvas
    Then the daemon returns to running
    And the session restore card should be visible
    And the restore button should mention "resume 1 agent"
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And the restored split sub-terminal should be visible
    And a restored terminal should replay the agent resume invocation "<resume>"
    And there should be no page errors

    Examples:
      | prefix                 | resume                                            |
      |                        | codex resume 00000000-0000-0000-0000-000000000001 |
      | KOLU_E2E_PROFILE=split | codex resume 00000000-0000-0000-0000-000000000001 |

  Scenario: Restore card surfaces resumable agents behind a global resume toggle
    Given a saved session with 2 terminals
    And terminal 0 has a resumable agent "claude --model sonnet"
    And terminal 1 has a resumable agent "codex --yolo"
    When I open the app
    Then the session restore card should be visible
    And the restore card should show the agent line "claude --model sonnet"
    And the restore card should show the agent line "codex --yolo"
    And the restore button should mention "resume 2 agents"
    When I turn off the resume-agents toggle
    Then the restore button should not mention "resume"
    And the restore card should not show the agent line "claude --model sonnet"
    And there should be no page errors

  Scenario: Plain shell terminals are grouped but carry no resume offer
    Given a saved session with 2 terminals
    When I open the app
    Then the session restore card should be visible
    And the restore button should not mention "resume"
    And there should be no page errors

  Scenario: Restore card heading shows basename, not full cwd path
    Given a saved session at cwd "/tmp/kolu-714-fixture"
    When I open the app
    Then the session restore card should be visible
    And the restore card heading should be "kolu-714-fixture"
    And the restore card heading should not contain "/"
    And there should be no page errors

  @kaval-restart
  Scenario: Restart kaval still offers the restore card after an earlier Restore
    Given a saved session with 2 terminals
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 2 workspace switcher entries
    When I open the kaval rail dialog
    And I restart kaval from the rail dialog
    Then the daemon returns to running
    And the session restore card should be visible
    When I click the restore button
    Then there should be 2 workspace switcher entries
    And there should be no page errors
