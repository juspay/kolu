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

  # Regression for #642: a saved canvas layout must survive session restore.
  # The client used to race the canvas's cascade-default effect against a
  # post-hoc setCanvasLayout RPC and lose — terminals ended up in the
  # default cascade instead of their saved positions.
  Scenario: Restored terminals preserve their canvas layout
    Given a saved session with canvas layout at x=420 y=180 w=640 h=360
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And the canvas tile should be at x=420 y=180 w=640 h=360
    And there should be no page errors

  # Regression guard for the multi-tile restore-from-empty-state path:
  # the saved `activeTerminalId` must survive `handleRestoreSession`
  # (i.e. `setActiveSilently` runs after all terminals are created), and
  # the canvas first-mount fallback effect (`TerminalCanvas.tsx:331`)
  # must center on that active tile rather than on the bounding box of
  # all tiles. The two saved tiles live at far-apart coordinates so the
  # bbox centre is at (0,0), not on either tile — a fallback-path
  # regression would leave the viewport at the bbox centre instead of
  # following the active id.
  Scenario: Restored multi-tile session preserves active terminal and centers viewport
    Given a saved session with 2 tiles and the second tile marked active
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 2 workspace switcher entries
    And the active canvas tile should match the saved-session second tile
    And the active canvas tile should be centered in the viewport
    And there should be no page errors

  Scenario: Active terminal persists across refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I select terminal 2 in the workspace switcher
    And I wait for the session auto-save
    And I reload the page and wait for ready
    Then workspace switcher entry 2 should be active
    And there should be no page errors

  # Regression guard for the centering side of refresh persistence. The
  # production bug is a race: on cold load the canvas first-mount centring
  # effect (`TerminalCanvas.tsx:331`) fires on the initial `terminalList`
  # snapshot; if `session.get` (carries `activeTerminalId`) hasn't yielded
  # yet, the effect sees a null `activeId`, takes the bbox-of-tiles fallback
  # branch, pans the viewport, and the `isDefaultViewport()` guard latches
  # the wrong centre for the rest of the session.
  #
  # The race winner shifts run to run, so we make the check deterministic
  # by installing a WebSocket init script that holds `session.get`'s first
  # yield for 500 ms — long enough that `terminalList.get` always wins the
  # race. One reload then surfaces the bug 100 % of the time. Tiles are
  # placed at far corners so the bbox midpoint sits ~2.8k px from the
  # active tile, making the failure geometrically unambiguous rather than
  # a tolerance-level call.
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
    When I wait for the session auto-save
    Given session.get's first yield is delayed by 500 ms to force the active-id race
    When I reload the page and wait for ready
    Then the saved active canvas tile should still be active
    And the active canvas tile should be centered in the viewport
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

  # Regression for #714: the restore card heading was showing the full cwd
  # path (e.g. `/home/alice/projects/foo`) for non-git terminals. The fix
  # decouples identity (`terminalKey().group`, full cwd, load-bearing for
  # collision detection) from presentation (`terminalDisplay().heading`,
  # cwd basename). The header should be the basename, never the full path.
  Scenario: Restore card heading shows basename, not full cwd path
    Given a saved session at cwd "/tmp/kolu-714-fixture"
    When I open the app
    Then the session restore card should be visible
    And the restore card heading should be "kolu-714-fixture"
    And the restore card heading should not contain "/"
    And there should be no page errors
