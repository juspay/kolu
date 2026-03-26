Feature: Theme switching
  Users can switch terminal themes via the command palette.
  Each terminal maintains its own theme independently.

  Background:
    Given the terminal is ready

  Scenario: Default theme is Tomorrow Night
    Then the terminal background should be "#1d1f21"

  Scenario: Switch theme via command palette
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    Then the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Theme persists after page refresh
    When I open the command palette
    And I select "Theme" in the palette
    And I select "Nord" in the palette
    And I refresh the page
    Then the terminal background should be "#2e3440"

  Scenario: Theme preview while navigating palette
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    Then the terminal background should be "#282a36"
    When I press Escape
    Then the terminal background should be "#1d1f21"
    And there should be no page errors

  Scenario: Theme preview commits on selection
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    Then the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Theme preview restores on backspace drill-out
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    Then the terminal background should be "#282a36"
    When I clear the palette input
    And I press Backspace
    Then the terminal background should be "#1d1f21"
    And there should be no page errors

  Scenario: Each terminal has independent theme
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    And I create a terminal
    Then the terminal background should be "#1d1f21"
    When I select sidebar entry 1
    Then the terminal background should be "#282a36"
