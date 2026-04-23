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
    And the "dark" theme slot should be selected in the palette
    And there should be no page errors

  Scenario: Terminal theme slots can be edited separately
    When I click the settings button
    And I click the "light" color scheme button
    And I click the theme name in the header
    Then the "light" theme slot should be selected in the palette
    When I type "3024 Day" in the palette
    And I press Enter
    Then the header should show theme "3024 Day"
    And the terminal background should be "#f7f7f7"
    When I click the theme name in the header
    And I click the "dark" theme slot in the palette
    And I type "Dracula" in the palette
    And I press Enter
    When I click the settings button
    And I click the "dark" color scheme button
    Then the header should show theme "Dracula"
    And the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Unset theme slot reuses the other slot
    When I click the settings button
    And I click the "light" color scheme button
    And I click the theme name in the header
    And I type "3024 Day" in the palette
    And I press Enter
    When I click the settings button
    And I click the "dark" color scheme button
    Then the header should show theme "3024 Day"
    And the terminal background should be "#f7f7f7"
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

  Scenario: Shuffle theme via keyboard shortcut
    When I press the shuffle theme shortcut
    Then the header theme should differ from "Tomorrow Night"
    And there should be no page errors

  # Regression: argmax-style picker ping-pongs between two themes when
  # the loop only sees the current bg as a peer (Theme A's farthest is
  # Theme B and vice versa). Shuffle must be random, not argmax.
  Scenario: Shuffle does not ping-pong between two themes
    When I press the shuffle theme shortcut 4 times
    Then the shuffle history should have at least 4 distinct themes
    And there should be no page errors

  Scenario: Shuffle theme via command palette
    When I open the command palette
    And I select "Shuffle theme" in the palette
    Then the header theme should differ from "Tomorrow Night"
    And there should be no page errors

  Scenario: Reopening theme palette refocuses search input
    When I click the theme name in the header
    Then the command palette should be visible
    And the palette search input should be focused
    When I press Escape
    Then the command palette should not be visible
    When I click the theme name in the header
    Then the command palette should be visible
    And the palette search input should be focused
    And there should be no page errors

  Scenario: Each terminal has independent theme
    When I open the command palette
    And I select "Theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    And I create a terminal
    Then the header should show theme "Tomorrow Night"
    # Select the newly created terminal (index 1 in createdTerminalIds),
    # then switch back to it after selecting the background terminal by pill tree position.
    When I select pill tree entry 1
    Then the header should show theme "Dracula"

