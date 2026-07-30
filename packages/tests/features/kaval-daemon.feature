Feature: kaval daemon lifecycle (B2 — the door)
  The server is a client of a kaval daemon it spawns. When the daemon dies
  mid-session the canvas must say so honestly — an explicit degraded state,
  visibly distinct from "you have no terminals" (#1034's empty-canvas lie).

  # @kaval-restart: this scenario SIGKILLs the worker's kaval daemon, leaving the
  # server degraded. The tagged After hook (support/hooks.ts) reboots the server
  # so the worker is healthy again for any later scenario the queue assigns it.
  @kaval-restart
  Scenario: Killing kaval mid-session shows the honest degraded canvas
    Given the terminal is ready
    When the kaval daemon is killed
    Then the degraded canvas is shown

  # W3.2 — the "Running daemons" leak diagnostic. Under a LOCAL binding the bound host IS
  # this machine, so the dialog shows exactly ONE group (the bound host's kavals, live one
  # badged "in use by kolu") and NOT a second "this machine, not the bound host" group — no
  # two lists for one truth. The bound-host list rides padiSurface's `hostInventory` member,
  # so it works identically over a remote ssh binding (proven in remotePadiSsh.test.ts).
  Scenario: The running-daemons list shows one group locally (no duplicate this-machine group)
    Given the terminal is ready
    When I open the kaval rail dialog
    Then the running-daemons list shows one group with the live kaval, no duplicate local group

  # W2.2 — "Restart kaval" recycles KAVAL, not padi. The button force-recycles the
  # terminal daemon (padi's `lifecycle.recycleKaval` procedure → capture → drain →
  # recycle kaval → park) while padi itself stays up. This is the DEAD-kaval arm:
  # kaval is SIGKILLed first, then the degraded canvas' Restart spawns a fresh
  # kaval — its gate pid changes, padi's does not — and the session captured
  # before the kill is offered for restore on the empty canvas.
  @kaval-restart
  Scenario: Restarting a DEGRADED kaval spawns a fresh daemon, keeps padi up, and preserves the session
    Given the terminal is ready
    When I capture the padi and kaval daemon pids
    And the kaval daemon is killed
    Then the degraded canvas is shown
    When I restart kaval from the degraded canvas
    Then the warming canvas is shown while kaval restarts
    And the restore card is not offered until kaval is connected
    When I press the create terminal shortcut while kaval restarts
    Then no terminal is created while kaval is warming
    Then the daemon returns to running
    And the kaval daemon has been recycled with a fresh pid
    And the padi daemon pid is unchanged
    And the session restore card should be visible
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And there should be no page errors

  # W2.2 — the LIVE-but-stuck arm, the crux of the fix. A running (not dead) kaval
  # must still be RECYCLED by Restart — killed + respawned — not adopted. The old
  # `daemon.restart` → drain path ADOPTED a live kaval, so a wedged-but-alive daemon
  # was never un-wedged; `recycleKaval` (always-recycle) kills it. Proof: with the
  # daemon healthy, Restart from the rail dialog CHANGES the kaval gate pid while
  # the padi gate pid stays put, and the live session survives the recycle to be
  # restored.
  @kaval-restart
  Scenario: Recycling kaval with a split does not spuriously re-parent it and keeps it visible
    Given the terminal is ready
    When I create a sub-terminal via command palette
    Then the sub-panel should be visible
    And the restored split sub-terminal should be visible
    When I capture the padi and kaval daemon pids
    And I start recording error toasts
    And I open the kaval rail dialog
    And I restart kaval from the rail dialog
    Then the warming canvas is shown while kaval restarts
    Then the daemon returns to running
    And the kaval daemon has been recycled with a fresh pid
    And the padi daemon pid is unchanged
    And no "Failed to set parent" error toast should have been shown
    And the session restore card should be visible
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And the sub-panel should be visible
    And the restored split sub-terminal should be visible
    And there should be no page errors
