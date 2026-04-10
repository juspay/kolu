Feature: Copy terminal text
  Copy the terminal buffer as plain text via keyboard shortcut or command palette.

  Background:
    Given the terminal is ready

  Scenario: Copy terminal text via command palette
    When I run "echo palette-copy-test"
    And the screen state should contain "palette-copy-test"
    And I open the command palette
    And I type "Copy terminal" in the palette
    And I press Enter
    Then a toast should appear with text "Copied terminal text to clipboard"
    And there should be no page errors
