Feature: Foreground process detection
  The sidebar shows the OSC 2 terminal title by default (the shell prompt sets
  this to e.g. "user@host: ~/dir"), falling back to the process binary name
  when no title has been emitted. Detection is event-driven via title changes
  from the shell preexec hook.

  Background:
    Given the terminal is ready

  Scenario: Sidebar shows terminal title at startup
    Then the sidebar process name should contain "@"
    And there should be no page errors
