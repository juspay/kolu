Feature: Copy pane as text
  Copy the terminal buffer as plain text via keyboard shortcut or command palette.

  Background:
    Given the terminal is ready

  Scenario: Server returns plain text via screenText API
    When I run "echo copy-pane-test-marker"
    Then the screenText API should return text containing "copy-pane-test-marker"
    And there should be no page errors

  Scenario: Copy pane via command palette
    When I run "echo palette-copy-test"
    And the screen state should contain "palette-copy-test"
    And I open the command palette
    And I type "Copy pane" in the palette
    And I press Enter
    Then a toast should appear with text "Copied pane text to clipboard"
    And there should be no page errors
