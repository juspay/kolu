@skip
Feature: Reconnect
  WebSocket disconnect → reconnect must not leave terminal streams dead.
  Regression harness for issue #410. Tagged @skip until the bug is fixed —
  run locally with `just test-quick features/reconnect.feature --tags @skip`.

  Scenario: Terminal output flows again after WebSocket drop and restore
    Given the terminal is ready
    When I run "echo kolu-before-drop"
    Then the screen state should contain "kolu-before-drop"
    When the WebSocket connection drops
    And the WebSocket connection is restored
    Then the connection status should eventually be "open"
    When I run "echo kolu-after-reconnect"
    Then the screen state should contain "kolu-after-reconnect"
