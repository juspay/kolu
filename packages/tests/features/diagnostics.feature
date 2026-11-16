Feature: Diagnostic info asks padi why it is slow
  The Diagnostic info dialog carries the active host's padi diagnostics:
  the child processes padi started, its event-loop stalls, and its file
  watchers. It proves the whole path, browser to padi and back.

  Scenario: The dialog shows padi's child processes and file watchers
    Given the terminal is ready
    When I open the command palette
    And I type "Diagnostic info" in the palette
    And I press Enter
    Then the padi diagnostics show a child process row and a watcher row
    And there should be no page errors
