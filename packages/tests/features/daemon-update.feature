Feature: Local PTY daemon — update-pending nudge + restart (#951 R4c)
  The `kolu --stdio` PTY-host daemon survives a kolu-server restart, so after a
  kolu upgrade the daemon keeps running the *previous* terminal-host code until
  it's restarted. kolu-server detects the mismatch — keyed on the pty-host
  *source* identity (the KOLU_PTY_HOST_BUILD_ID hash nix bakes from
  packages/pty-host/), NOT the inert pkgVersion (the #1031 bug) and NOT the
  whole kolu binary (so a server- or client-only deploy no longer nudges) — and
  surfaces an "update pending" nudge in the ChromeBar. Restarting the daemon is
  a deliberate, terminal-losing action behind a confirm; it clears the nudge
  and the daemon comes back on the current terminal host.

  The mismatch is reproduced with a build-id override on the server restart —
  KOLU_BUILD_ID_OVERRIDE is the highest-precedence test seam, above the
  production pty-host source key. The surviving daemon was spawned by the prior,
  un-overridden server, so the fresh server sees it as stale, exactly as it
  would after a real deploy.

  Scenario: Update-pending nudge appears after an upgrade and a restart clears it
    Given the terminal is ready
    When I run "echo daemon-update-marker"
    Then the screen state should contain "daemon-update-marker"
    When the kolu server restarts as a newer build
    Then the connection status should eventually be "open"
    And the update-pending nudge should appear
    When I restart the local PTY daemon via the nudge
    Then the update-pending nudge should disappear
    And there should be no terminals
    And there should be no page errors
