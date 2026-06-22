Feature: Chrome bar memory readout
  The identity rail surfaces live memory usage for the processes it names —
  the kolu-server's RSS, this browser's JS heap, and the kaval daemon's RSS —
  so a user can glance at memory pressure without opening Diagnostic Info.

  Scenario: The identity rail shows live, changing memory usage
    Given the terminal is ready
    Then the chrome bar shows server memory usage
    And the chrome bar shows client memory usage
    And the chrome bar shows kaval memory usage
    # Drive real growth: a burst of terminal output fills the browser's xterm
    # buffer (client heap climbs) and the daemon's mirror + the server's proxy
    # (kaval / server RSS climb), so the readouts visibly move — the evidence clip
    # captures the numbers changing, not a static snapshot.
    When I run "seq 1 100000"
    And I run "seq 1 100000"
    And I run "seq 1 100000"
    Then the chrome bar shows client memory usage
    And the chrome bar shows kaval memory usage
