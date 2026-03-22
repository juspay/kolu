Feature: Theme switching
  Users can switch terminal themes via the command palette.
  Each terminal maintains its own theme independently.

  Background:
    Given the terminal is ready

  Scenario: Default theme name shown in header
    Then the header should show theme "Tomorrow Night"

  Scenario: Switch theme via command palette
    When I open the command palette
    And I type "Theme: Dracula" in the palette
    And I press Enter
    Then the header should show theme "Dracula"
    And there should be no page errors

  Scenario: Theme persists after page refresh
    When I open the command palette
    And I type "Theme: Nord" in the palette
    And I press Enter
    And I refresh the page
    Then the header should show theme "Nord"

  Scenario: Each terminal has independent theme
    When I open the command palette
    And I type "Theme: Dracula" in the palette
    And I press Enter
    And I create a terminal
    Then the header should show theme "Tomorrow Night"
    # Select the newly created terminal (index 1 in createdTerminalIds),
    # then switch back to it after selecting the background terminal by sidebar position.
    When I select sidebar entry 1
    Then the header should show theme "Dracula"

