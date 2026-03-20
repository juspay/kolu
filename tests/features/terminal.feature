Feature: Terminal
  Terminal canvas rendering, resizing, and keyboard shortcuts.

  Background:
    Given I create a terminal with id "default" and label "default"
    And the terminal is ready

  Scenario: Terminal accepts input
    When I run "echo kolu-test"
    Then the terminal canvas should be visible
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
    Given I intercept WebSocket messages
    When I zoom in 1 time
    And I zoom out 1 time
    Then no raw keystroke "=" "-" "+" should have been sent via WebSocket
    And there should be no page errors

  Scenario: Initial resize is sent to PTY on connect
    Given I intercept WebSocket messages from page load
    When the page reloads and the terminal is ready
    Then a Resize message with cols greater than 80 should have been sent
    And there should be no page errors

  Scenario: Zoom changes font size
    Given I note the font size
    When I zoom in 1 time
    Then the font size should be larger than before
    When I zoom out 2 times
    Then the font size should be smaller than the original
    And there should be no page errors
