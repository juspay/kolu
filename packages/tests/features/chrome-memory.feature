Feature: Chrome bar memory detail
  The compact identity rail keeps live memory telemetry for the processes it
  names — the kolu-server's RSS, this browser's JS heap, and the kaval daemon's
  RSS — without crowding the always-visible chrome.

  Scenario: The identity rail keeps live, changing memory usage in details
    Given the terminal is ready
    Then the identity rail details include server memory usage
    And the identity rail details include client memory usage
    And the identity rail details include kaval memory usage
    # Drive real growth: a burst of terminal output fills the browser's xterm
    # buffer (client heap climbs) and the daemon's mirror + the server's proxy
    # (kaval / server RSS climb), so the readouts visibly move — the evidence clip
    # captures the numbers changing, not a static snapshot.
    When I run "seq 1 100000"
    And I run "seq 1 100000"
    And I run "seq 1 100000"
    Then the identity rail details include client memory usage
    And the identity rail details include kaval memory usage
