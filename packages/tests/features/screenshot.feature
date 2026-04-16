Feature: Terminal screenshot
  Copy the rendered terminal pixels to the clipboard as a PNG image via the
  camera button in each canvas-mode tile's title bar.

  Background:
    Given the terminal is ready

  Scenario: Screenshot button appears in canvas tile title bar
    When I click the canvas mode toggle
    Then the screenshot button should be visible on canvas tile 1
    And there should be no page errors

  Scenario: Screenshot button is not rendered in focus mode tile chrome
    Then the screenshot button should not be visible in the focus-mode chrome
    And there should be no page errors

  Scenario: Click screenshot button copies image to clipboard
    When I click the canvas mode toggle
    And I click the screenshot button on canvas tile 1
    Then a toast should appear with text "Screenshot copied to clipboard"
    And the clipboard should contain a PNG image
    And there should be no page errors

  Scenario: Screenshot command palette entry copies image to clipboard
    When I open the command palette
    And I type "Copy terminal screenshot" in the palette
    And I press Enter
    Then a toast should appear with text "Screenshot copied to clipboard"
    And the clipboard should contain a PNG image
    And there should be no page errors
