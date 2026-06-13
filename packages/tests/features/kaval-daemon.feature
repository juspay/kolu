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

  # B3 — survival: the degraded canvas is now self-healing. "Restart kaval"
  # recycles the daemon (capture → recycle → reattach over the daemon.restart RPC)
  # and the honest surface clears once it reconnects. (Adopting a SURVIVING daemon
  # across a server-only redeploy, and the staleKey-skew update nudge, are the
  # staged-prod gate — CI can't redeploy over a live daemon; see pty-daemon.mdx
  # "The gate — the second deploy".)
  @kaval-restart
  Scenario: Restarting kaval from the degraded canvas brings it back
    Given the terminal is ready
    When the kaval daemon is killed
    Then the degraded canvas is shown
    When I click restart kaval on the degraded canvas
    Then kaval reconnects and the degraded canvas clears
