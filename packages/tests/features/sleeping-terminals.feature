Feature: Sleeping terminals
  A terminal can be put to SLEEP — its PTY / xterm / agent released and the
  tile flipped to a dormant "sleeping" arm IN PLACE on the SAME id — and WOKEN
  later, which re-spawns the PTY on that id and resumes the agent
  (session-restore-of-one). Sleeping tiles stay full canvas citizens
  (drag / resize / render) but show a frozen, PTY-less body.

  These scenarios drive the real user JOURNEYS and assert the real OUTCOMES:
  the woken terminal resumes the SAME conversation (not a blank fresh agent);
  a dragged sleeping tile stays where it was left across a reload; a slept
  session survives a full daemon restart; and wake/restart convergence never
  creates an orphan or duplicate tile.

  @codex-mock
  Scenario: Waking a sleeping agent terminal resumes the SAME conversation
    Given the terminal is ready
    When a Codex session is mocked with state "waiting"
    Then the tile chrome should show a Codex indicator with state "waiting"
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the dock should show 1 sleeping row
    And the dormant tile should show its saved working directory
    When I wake the slept terminal via the dormant body wake button
    Then the slept terminal should be live
    And the woken terminal should replay the agent resume invocation "codex resume 00000000-0000-0000-0000-000000000001"
    And the woken terminal should resume in the same working directory
    And there should be no page errors

  Scenario: Sleeping a terminal freezes its splits too, and Wake brings the family back
    Given the terminal is ready
    When I start recording error toasts
    And I create a sub-terminal via command palette
    And I remember the tile's split pane
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the tile and its 1 split pane should be dormant
    And no toast mentioning "Sleeping closes" should have been shown
    And the dock should show 2 sleeping rows
    When I wake the slept terminal via the dormant body wake button
    Then the tile and its split should be live again
    And there should be no page errors

  Scenario: Restart from the tile title bar gives back a fresh shell on the same tile
    Given the terminal is ready
    When I run "echo before-restart-marker"
    Then the terminal buffer should contain "before-restart-marker"
    When I click the tile restart button
    Then the terminal buffer should no longer contain "before-restart-marker"
    When I run "echo after-restart-marker"
    Then the terminal buffer should contain "after-restart-marker"
    And the slept terminal should be live
    And there should be no page errors

  Scenario: A dragged sleeping tile keeps its moved position across a reload
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    When I move the sleeping tile to x=815 y=437
    And I refresh the page
    Then the slept terminal should be sleeping
    And the sleeping tile should be at x=815 y=437
    And there should be no page errors

  @codex-mock @kaval-restart
  Scenario: A slept agent terminal survives a daemon restart and still wakes-to-resume
    Given the terminal is ready
    When a Codex session is mocked with state "waiting"
    Then the tile chrome should show a Codex indicator with state "waiting"
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    When the kaval daemon is killed
    Then the degraded canvas is shown
    When I restart kaval from the degraded canvas
    Then the daemon returns to running
    And the session restore card should be visible
    When I click the restore button
    Then the restored sleeping tile should be sleeping
    When I wake the restored sleeping tile via the dormant body wake button
    Then the restored sleeping tile should be live
    And the woken terminal should replay the agent resume invocation "codex resume 00000000-0000-0000-0000-000000000001"
    And there should be no page errors

  @kaval-restart
  Scenario: A daemon restart mid-sleep converges with no orphan tile
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    When the kaval daemon is killed
    Then the degraded canvas is shown
    When I restart kaval from the degraded canvas
    Then the daemon returns to running
    And the session restore card should be visible
    When I click the restore button
    Then the restored sleeping tile should be sleeping
    And there should be exactly 1 canvas tile
    And there should be no page errors

  Scenario: The dock's ☾ toggle hides and re-shows sleeping terminals
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the dock should show 1 sleeping row
    When I toggle the dock's sleeping-terminal filter
    Then the dock should show 0 sleeping rows
    When I toggle the dock's sleeping-terminal filter
    Then the dock should show 1 sleeping row
    And there should be no page errors

  Scenario: The dock's 'show all' reset re-shows hidden sleeping terminals
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the dock should show 1 sleeping row
    When I toggle the dock's sleeping-terminal filter
    Then the dock should show 0 sleeping rows
    When I click the dock's show-all filter reset
    Then the dock should show 1 sleeping row
    And there should be no page errors

  Scenario: A sleeping terminal offers no kaval-tui attach command in the Inspector
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show the kaval-tui attach command
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the inspector should not show a kaval-tui attach command
    And there should be no page errors
