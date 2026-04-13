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

  Scenario: Copy text from a focused split terminal
    When I run "echo parent-only-text"
    And the screen state should contain "parent-only-text"
    And I create a sub-terminal via command palette
    And the sub-terminal should have keyboard focus
    And I run "echo split-unique-text" in the sub-terminal
    And the sub-terminal screen should contain "split-unique-text"
    And I open the command palette
    And I type "Copy terminal" in the palette
    And I press Enter
    Then a toast should appear with text "Copied terminal text to clipboard"
    And the clipboard should contain "split-unique-text"
    And the clipboard should not contain "parent-only-text"
