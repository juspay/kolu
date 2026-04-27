Feature: Copy terminal selection via Ctrl+C
  On Linux/Windows, Ctrl+C with an xterm selection copies the selection to
  the clipboard and suppresses SIGINT. Without a selection, Ctrl+C falls
  through to xterm and sends 0x03 to the PTY so the running process is
  interrupted as before.

  Background:
    Given the terminal is ready

  Scenario: Ctrl+C with selection copies to clipboard and suppresses SIGINT
    Given I intercept oRPC sendInput calls
    When I run "echo ctrl-c-copy-test"
    And the screen state should contain "ctrl-c-copy-test"
    And I select all terminal output
    And I press Control+c
    Then the clipboard should contain "ctrl-c-copy-test"
    And no sendInput call should contain the SIGINT byte
    And there should be no page errors

  Scenario: Ctrl+C without selection sends SIGINT to the PTY
    Given I intercept oRPC sendInput calls
    When I run "echo no-selection-marker"
    And the screen state should contain "no-selection-marker"
    And I press Control+c
    Then a sendInput call should contain the SIGINT byte
    And there should be no page errors
