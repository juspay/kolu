Feature: Foreground process detection
  The sidebar shows the name of the foreground process running in each terminal.
  Detection is event-driven via OSC 2 title changes from the shell preexec hook.

  Background:
    Given the terminal is ready

  Scenario: Sidebar shows shell process name at startup
    Then the sidebar process name should be "bash"
    And there should be no page errors

  Scenario: Header shows foreground process name
    Then the header should contain the text "bash"
    And there should be no page errors
