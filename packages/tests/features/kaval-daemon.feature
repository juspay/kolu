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

  # B3.2 — supervised restart. The "Restart kaval" button the degraded canvas
  # used to defer now recovers the daemon: the session is captured before the
  # kill, a fresh daemon is spawned, and the preserved session is offered for
  # restore on the empty canvas — the round-trip a session-preserving restart
  # promises.
  @kaval-restart
  Scenario: Restarting kaval recovers a degraded daemon and preserves the session
    Given the terminal is ready
    When the kaval daemon is killed
    Then the degraded canvas is shown
    When I restart kaval from the degraded canvas
    Then the warming canvas is shown while kaval restarts
    And the restore card is not offered until kaval is connected
    When I press the create terminal shortcut while kaval restarts
    Then no terminal is created while kaval is warming
    Then the daemon returns to running
    And the session restore card should be visible
    When I click the restore button
    Then there should be 1 workspace switcher entries
    And there should be no page errors
