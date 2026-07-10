Feature: Sleeping terminals
  A terminal can be put to SLEEP — its PTY / xterm / agent released and the
  tile flipped to a dormant "sleeping" arm IN PLACE on the SAME id — and WOKEN
  later, which re-spawns the PTY on that id and resumes the agent
  (session-restore-of-one). Sleeping tiles stay full canvas citizens
  (drag / resize / render) but show a frozen, PTY-less body.

  These scenarios drive the real user JOURNEYS and assert the real OUTCOMES:
  the woken terminal resumes the SAME conversation (not a blank fresh agent);
  a dragged sleeping tile stays where it was left across a reload; a slept
  session survives a full daemon restart; a malformed persisted record is
  dropped, not fatal; and sleeping the only terminal never clears the session.

  @codex-real @real-agent
  Scenario: Waking a slept real-codex terminal resumes the SAME session
    # Run the REAL codex against ollama so the server captures `lastAgentCommand`
    # AND the live session's thread id; record that id from ~/.codex before sleep.
    # Sleep via the tile ☾ button (PTY released, dormant body shows), then wake:
    # the PTY re-spawns on the SAME id and the server replays the RESUME-BY-ID form
    # (`codex resume <thread-id>`, juspay/kolu#1495) into the fresh PTY — so the
    # EXACT prior conversation comes back. A blank fresh agent would type NOTHING,
    # a wrong-session resume a DIFFERENT id; asserting the RECORDED id lands in the
    # woken buffer is exactly the hole the agent-resume bug fell through. (srid's
    # stage-6 (b) real attempt: id-equality, not the mock's fixed thread.)
    Given the terminal is ready
    When I launch the real Codex agent with prompt "Say the single word DONE and then stop."
    And the tile chrome should show a Codex indicator within 60 seconds
    And I record the real Codex session id
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the dock should show 1 sleeping row
    When I wake the slept terminal via the dormant body wake button
    Then the slept terminal should be live
    And the woken terminal should replay the recorded Codex resume invocation
    And there should be no page errors

  Scenario: A dragged sleeping tile keeps its moved position across a reload
    # Sleep a terminal, drag its dormant tile to a new canvas position, then
    # refresh. The moved layout must round-trip through persistence — the
    # sleeping tile reappears at the position it was dragged to, proving a
    # dormant tile is a full canvas citizen whose layout is persisted like any
    # live tile's. The drag goes through the same setCanvasLayout the drag handle
    # drives, then the reload proves it survived the persistence round-trip.
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    When I move the sleeping tile to x=815 y=437
    And I refresh the page
    Then the slept terminal should be sleeping
    And the sleeping tile should be at x=815 y=437
    And there should be no page errors

  @codex-real @real-agent @kaval-restart
  Scenario: A slept real-codex terminal survives a daemon restart and still wakes-to-resume
    # The strongest journey: sleep a REAL-codex terminal, then restart the kaval
    # daemon (session-preserving restart — capture before kill). The slept record
    # must outlive the restart and come back via the restore card as a DORMANT
    # tile. Waking it then resumes the agent exactly as before — the by-id resume
    # invocation (`codex resume <recorded thread-id>`, juspay/kolu#1495) replays
    # into the re-spawned PTY.
    Given the terminal is ready
    When I launch the real Codex agent with prompt "Say the single word DONE and then stop."
    And the tile chrome should show a Codex indicator within 60 seconds
    And I record the real Codex session id
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
    And the woken terminal should replay the recorded Codex resume invocation
    And there should be no page errors

  @kaval-restart
  Scenario: A daemon restart mid-sleep converges with no orphan tile
    # A restart while a terminal is sleeping must converge to EXACTLY one tile for
    # that terminal — no duplicate, no orphan PTY adopted alongside the restored
    # record. Sleep the only terminal, restart, restore, and assert the sleeping
    # tile is present AND singular (exactly one canvas tile on the canvas).
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

  Scenario: A malformed sleeping record is dropped while the good one restores
    # Plant TWO sleeping records into the saved session: one well-formed, one
    # MALFORMED (a non-UUID id — the one defect that PASSES the loose persisted-
    # session schema so the session plants, yet is DROPPED per-record at the
    # server's seed boundary, which re-checks the id against the strict UUID
    # schema). On a cold restore the good sleeping tile must come back DORMANT and
    # the malformed one must be dropped — no crash, no freeze, no second tile. The
    # guard: exactly one sleeping tile and exactly one canvas tile after restore.
    Given a saved session with one good and one malformed sleeping record
    When I open the app
    Then the session restore card should be visible
    And the restore card should mark a sleeping terminal as asleep
    When I click the restore button
    Then the restored sleeping tile should be sleeping
    And there should be exactly 1 canvas tile
    And there should be no page errors

  Scenario: Sleeping the only terminal does not clear the session
    # Sleeping the last terminal must NOT be read as "no terminals" — the dormant
    # tile stays on the canvas and the workspace switcher keeps its single entry.
    # A regression that cleared the session on the last terminal would leave the
    # canvas empty; here the sleeping tile must remain.
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And there should be exactly 1 canvas tile
    And the workspace switcher should have 1 terminal entry
    And there should be no page errors

  Scenario: The dock's ☾ toggle hides and re-shows sleeping terminals
    # The dock footer's ☾ toggle is an independent filter from the activity
    # window: it hides `sleeping`-bucket rows. Sleep the only terminal, hide it
    # via the toggle (the sleeping row drops), then toggle again to bring it
    # back — proving the filter is reversible AND that hiding the last visible
    # row doesn't strand the footer (the toggle must stay reachable to un-hide).
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
    # The combined `N hidden · show all` reset is a primary behavior of this
    # change: it relaxes BOTH filters in one click. Hide the sleeping row via
    # the ☾ toggle (which makes the reset appear, since a filter is now hiding
    # a row), click `show all`, and assert the sleeping row returns — proving
    # the combined reset actually un-hides sleeping, not just the window.
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
    # A slept terminal released its PTY, so it is no longer one of kaval's
    # terminals — a kaval-tui attach/snapshot command would have nothing to reach.
    # The Inspector's Attach section is live while the tile is active and must
    # disappear once it is dormant, rather than handing over a dead command.
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show the kaval-tui attach command
    When I sleep the active terminal via the tile sleep button
    Then the slept terminal should be sleeping
    And the inspector should not show a kaval-tui attach command
    And there should be no page errors
