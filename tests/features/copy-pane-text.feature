Feature: Copy terminal text
  Copy the terminal buffer as plain text via keyboard shortcut or command palette.

  Background:
    Given the terminal is ready

  Scenario: Server returns plain text via screenText API
    When I run "echo copy-terminal-test-marker"
    Then the screenText API should return text containing "copy-terminal-test-marker"
    And there should be no page errors

  Scenario: Copy terminal text via command palette
    When I run "echo palette-copy-test"
    And the screen state should contain "palette-copy-test"
    And I open the command palette
    And I type "Copy workspace" in the palette
    And I press Enter
    Then a toast should appear with text "Copied workspace text to clipboard"
    And there should be no page errors
