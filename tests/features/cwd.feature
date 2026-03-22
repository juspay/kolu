Feature: Header CWD display
  The header shows the active terminal's current working directory,
  updating reactively as the user cd's around.

  Background:
    Given the terminal is ready

  Scenario: Header shows CWD after cd
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    And there should be no page errors

  Scenario: Header CWD updates on subsequent cd
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    When I run "cd /"
    Then the header CWD should show "/"
    And there should be no page errors
