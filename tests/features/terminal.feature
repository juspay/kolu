Feature: Terminal
  Terminal canvas rendering, resizing, and keyboard shortcuts.

  Background:
    Given the terminal is ready

  Scenario: Terminal accepts input
    When I run "echo kolu-test"
    Then the terminal canvas should be visible
    And there should be no page errors

  Scenario: Terminal survives browser refresh
    When I run "echo kolu-refresh-test"
    And I refresh the page
    And the terminal is ready
    Then the terminal should contain "kolu-refresh-test"
    And there should be no page errors

  Scenario: Terminal resizes with viewport
    Given I note the canvas dimensions
    When I resize the viewport to 800x400
    Then the canvas should be smaller than before
    When I resize the viewport to 1400x900
    Then the canvas should be larger than the 800x400 size
    And there should be no page errors

  Scenario: Canvas fills its container
    Then the canvas should fill at least 90% of its container
    And there should be no page errors

  Scenario: Canvas fills container after zoom
    When I zoom in 2 times
    Then the canvas should fill at least 90% of its container
    When I zoom out 3 times
    Then the canvas should fill at least 90% of its container
    And there should be no page errors

  Scenario: Zoom shortcuts do not leak keystrokes
    Given I intercept oRPC sendInput calls
    When I zoom in 1 time
    And I zoom out 1 time
    Then no sendInput call should contain "=" "-" "+"
    And there should be no page errors

  Scenario: Initial resize is sent to PTY on connect
    When I run "echo $COLUMNS > /tmp/kolu-test-cols"
    Then the file "/tmp/kolu-test-cols" should contain a number greater than 80
    And there should be no page errors

  Scenario: Clicking terminal focuses input
    When I click the terminal canvas
    Then the terminal input should be focused
    And there should be no page errors

  Scenario: Zoom changes font size
    Given I note the font size
    When I zoom in 1 time
    Then the font size should be larger than before
    When I zoom out 2 times
    Then the font size should be smaller than the original
    And there should be no page errors
