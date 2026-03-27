Feature: Theme switching
  Users can switch terminal themes via the command palette.
  Each terminal maintains its own theme independently.

  Background:
    Given the terminal is ready

  Scenario: Default theme name shown in header
    Then the header should show theme "Tomorrow Night"

  Scenario: Switch theme via command palette
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    Then the header should show theme "Dracula"
    And the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Theme persists after page refresh
    When I open the command palette
    And I select "Theme" in the palette
    And I select "Nord" in the palette
    And I refresh the page
    Then the header should show theme "Nord"

  Scenario: Click theme name opens palette with theme group
    When I click the theme name in the header
    Then the command palette should be visible
    And the palette breadcrumb should show "Theme"
    And the palette search input should be focused
    And there should be no page errors

  Scenario: Theme preview while navigating palette
    When I click the theme name in the header
    And I type "Dracula" in the palette
    Then the header should show theme "Dracula"
    And the terminal background should be "#282a36"
    When I press Escape
    Then the header should show theme "Tomorrow Night"
    And there should be no page errors

  Scenario: Theme preview commits on selection
    When I click the theme name in the header
    And I type "Dracula" in the palette
    And I press Enter
    Then the header should show theme "Dracula"
    And the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Theme preview restores on backspace drill-out
    When I click the theme name in the header
    And I type "Dracula" in the palette
    Then the header should show theme "Dracula"
    When I clear the palette input
    And I press Backspace
    Then the header should show theme "Tomorrow Night"
    And there should be no page errors

  Scenario: Each terminal has independent theme
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    And I create a terminal
    Then the header should show theme "Tomorrow Night"
    # Select the newly created terminal (index 1 in createdTerminalIds),
    # then switch back to it after selecting the background terminal by sidebar position.
    When I select sidebar entry 1
    Then the header should show theme "Dracula"

