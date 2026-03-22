Feature: Theme Switching
  Switch between terminal color themes via command palette.

  Background:
    Given the terminal is ready

  Scenario: Switch theme via command palette
    When I open the command palette
    And I type "Theme: Dracula" in the palette
    And I press Enter
    Then the command palette should not be visible
    And the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Theme persists across page reload
    When I open the command palette
    And I type "Theme: Nord" in the palette
    And I press Enter
    And I reload the page
    And I wait for the terminal to be ready
    Then the terminal background should be "#2e3440"
    And there should be no page errors

  Scenario: Filter theme commands
    When I open the command palette
    And I type "Theme:" in the palette
    Then the command palette should show 8 results
    And there should be no page errors
