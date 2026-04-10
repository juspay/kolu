Feature: Reconnect
  WebSocket disconnect → reconnect must not leave terminal streams dead.
  Regression test for issue #410 — the oRPC ClientRetryPlugin transparently
  re-subscribes streaming procedures on transport reconnect.

  Scenario: Terminal output flows again after WebSocket drop and restore
    Given the terminal is ready
    When I run "echo kolu-before-drop"
    Then the screen state should contain "kolu-before-drop"
    When the WebSocket connection drops
    And the WebSocket connection is restored
    Then the connection status should eventually be "open"
    When I run "echo kolu-after-reconnect"
    Then the screen state should contain "kolu-after-reconnect"
