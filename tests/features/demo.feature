@demo
Feature: Demo recording
  Capture a GIF/MP4 demo of kolu's terminal in action.

  Scenario: Record terminal demo
    Given the terminal is ready
    And frame capture is started
    When I run "echo hello from kolu"
    And I wait 2 seconds
    When I run "uname -a"
    And I wait 3 seconds
    And I wait 1 second
    Then frame capture is stopped
