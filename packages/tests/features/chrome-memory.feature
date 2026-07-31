Feature: Chrome bar memory detail
  The compact identity rail keeps live memory telemetry for the processes it
  names — the kolu-server's RSS, the padi process's RSS, and its kaval daemon's
  RSS, plus this browser's JS heap — without crowding the always-visible chrome.
  The full figures also read out inside each identity dialog. (padi owns kaval now,
  so kaval's RSS rides padi's readout, folded into the rail cell server-side.)

  Scenario: The identity rail keeps live, changing memory usage in details
    Given the terminal is ready
    Then the identity rail details include server memory usage
    And the identity rail details include padi memory usage
    And the identity rail details include client memory usage
    And the identity rail details include kaval memory usage
    # Drive real growth: a burst of terminal output fills the browser's xterm
    # buffer (client heap climbs) and the padi/kaval processes' RSS climb, so the
    # readouts visibly move — the evidence clip captures the numbers changing, not a
    # static snapshot.
    When I run "seq 1 100000"
    And I run "seq 1 100000"
    And I run "seq 1 100000"
    Then the identity rail details include client memory usage
    And the identity rail details include kaval memory usage
