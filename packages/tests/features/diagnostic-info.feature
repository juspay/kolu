Feature: Diagnostic info
  Debug → Diagnostic info renders the server-runtime registry alongside
  browser and xterm state. Lets a user (or support handler) copy a
  single JSON snapshot for bug reports.

  Background:
    Given the terminal is ready

  Scenario: Diagnostic info exposes server resources and collapsed WebGL events
    When I open the command palette
    And I select "Debug" in the palette
    And I select "Diagnostic info" in the palette
    Then the diagnostic info dialog should be visible
    And the diagnostic info should show server, resources, and xterm sections
    And WebGL recent events should be collapsed
    When I copy diagnostic info JSON
    Then the copied diagnostic info JSON should include server diagnostics
