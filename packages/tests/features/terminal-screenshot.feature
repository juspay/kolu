Feature: Terminal screenshot
  Copy the active terminal's contents to the clipboard as a PNG. Surfaced
  via a camera button in each canvas-mode tile's title bar, a keyboard
  shortcut for the active terminal, and a command palette entry.

  Background:
    Given the terminal is ready

  Scenario: Screenshot button is visible on canvas tile
    When I click the canvas mode toggle
    Then there should be 1 canvas tile
    And the screenshot button should be visible on canvas tile 1
    And there should be no page errors

  Scenario: Click screenshot button copies terminal screenshot
    When I run "echo screenshot-canvas-test"
    And the screen state should contain "screenshot-canvas-test"
    And I click the canvas mode toggle
    And I click the screenshot button on canvas tile 1
    Then a toast should appear with text "Screenshot copied"
    And there should be no page errors

  Scenario: Keyboard shortcut copies terminal screenshot
    When I run "echo screenshot-shortcut-test"
    And the screen state should contain "screenshot-shortcut-test"
    And I press the screenshot terminal shortcut
    Then a toast should appear with text "Screenshot copied"
    And there should be no page errors

  Scenario: Command palette entry copies terminal screenshot
    When I run "echo screenshot-palette-test"
    And the screen state should contain "screenshot-palette-test"
    And I open the command palette
    And I type "Screenshot terminal" in the palette
    And I press Enter
    Then a toast should appear with text "Screenshot copied"
    And there should be no page errors
