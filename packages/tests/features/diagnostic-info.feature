Feature: Diagnostic info
  Debug diagnostic info groups browser, xterm, and server runtime state.

  Scenario: Diagnostic info shows server watches and collapsed WebGL events
    When I open the command palette
    And I select "Debug" in the palette
    And I select "Diagnostic info" in the palette
    Then the diagnostic info dialog should be visible
    And the diagnostic info should show server and xterm groups
    And WebGL recent events should be collapsed
    When I copy diagnostic info JSON
    Then the copied diagnostic info JSON should include server diagnostics
