Feature: Sleeping terminals
  A terminal can be put to sleep (PTY released, the record frozen) and woken
  (restore-one → a fresh active terminal with its agent resumed). Sleeping
  records are first-class on every presence surface — canvas, dock, minimap,
  switcher — and a malformed persisted one is tolerated, not fatal.

  # --- sleep-doesnt-vanish-incl-last ---
  Scenario: Sleeping the last terminal keeps it on the canvas
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then canvas tile 1 should be sleeping
    And the dock should show 1 sleeping row
    And the workspace switcher should have 1 terminal entry

  # --- wake-usable ---
  Scenario: Waking a sleeping terminal lands a usable live terminal
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then canvas tile 1 should be sleeping
    When I wake the active sleeping tile
    Then the terminal canvas should be visible
    When I run "echo woke-up-marker"
    Then the active terminal should show "woke-up-marker"

  # --- close-discards ---
  Scenario: Closing a sleeping tile routes through the discard confirm
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then canvas tile 1 should be sleeping
    When I click the tile close button for terminal 1
    Then the close confirmation should be visible
    And the close confirmation should read "discard sleeping terminal"
    When I confirm the close
    Then the workspace switcher should have 0 terminal entries

  # --- long-slept-shows-on-each-surface (NOT parked-dropped) ---
  Scenario: A long-slept terminal stays visible on every presence surface
    Given the terminal is ready
    When I sleep the active terminal via the tile sleep button
    Then canvas tile 1 should be sleeping
    And the dock should show 1 sleeping row
    And the minimap should show 1 sleeping marker
    When I press the workspace switcher shortcut
    Then the workspace switcher should show 1 sleeping entry

  # --- malformed-record-tolerated (good survives, bad dropped) ---
  # The malformed record can ONLY reach disk directly (the session RPC's wire
  # validator rejects it), so this scenario writes config.json (one VALID + one
  # malformed sleeping record) and cold-reboots the server. Sleeping records seed
  # AS sleeping at boot, independent of any live PTY, so the good one rehydrates;
  # the malformed one is dropped at the read boundary (`tolerateSleepingRecord`),
  # never fatal. Asserting exactly 1 sleeping row proves a single corrupt record
  # does not poison the rest of the set.
  @sleeping-malformed
  Scenario: A malformed persisted sleeping record is dropped, the good one survives
    Given a malformed sleeping record and one good sleeping record on disk
    When I open the rebooted app
    Then the rebooted app should become usable
    And the dock should show 1 sleeping row
    And there should be no page errors
