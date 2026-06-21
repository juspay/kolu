Feature: Chrome bar memory readout
  The identity rail surfaces live memory usage for the processes it names —
  the kolu-server's RSS, this browser's JS heap, and the kaval daemon's RSS —
  so a user can glance at memory pressure without opening Diagnostic Info.

  Scenario: The identity rail shows server, client, and kaval memory
    Given the terminal is ready
    Then the chrome bar shows server memory usage
    And the chrome bar shows client memory usage
    And the chrome bar shows kaval memory usage
