Feature: Foreground process detection
  The workspace switcher shows the OSC 2 terminal title. Our injected shell hooks
  set the title to the CWD at every prompt (precmd) and to the running
  command while it executes (preexec). Detection is event-driven via
  title changes.

  Background:
    Given the terminal is ready

  Scenario: Workspace switcher shows terminal title at startup
    Then the workspace switcher process name should be non-empty
    And there should be no page errors

  Scenario: Workspace switcher title updates to the running command
    When I run a long-running "sleep 5" command
    Then the workspace switcher process name should contain "sleep"
    And there should be no page errors
