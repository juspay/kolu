Feature: Foreground process detection
  The sidebar shows the name of the foreground process running in each terminal.
  Detection is event-driven via OSC 2 title changes from the shell preexec hook.

  Background:
    Given the terminal is ready

  Scenario: Sidebar shows shell process name
    Then the sidebar should show a process name
    And there should be no page errors

  Scenario: Process name updates when running a command
    When I run "cat /dev/null"
    Then the sidebar process name should eventually change
    And there should be no page errors
