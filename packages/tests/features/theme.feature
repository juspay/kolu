Feature: Theme switching
  Users can switch terminal themes via the command palette.
  Each terminal maintains its own theme independently.

  Background:
    Given the terminal is ready

  Scenario: Default theme name shown in header
    Then the header should show theme "Tomorrow Night"

  Scenario: Switch theme via command palette
    When I open the command palette
    And I select "Set theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    Then the header should show theme "Dracula"
    And the terminal background should be "#282a36"
    And there should be no page errors

  Scenario: Theme persists after page refresh
    When I open the command palette
    And I select "Set theme" in the palette
    And I select "Nord" in the palette
    And I refresh the page
    Then the header should show theme "Nord"

  Scenario: Click theme name opens palette with theme group
    When I click the theme name in the header
    Then the command palette should be visible
    And the palette breadcrumb should show "Set theme"
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

  # Regression (#1480): a tile on the default (unset) theme dropped its theme
  # pill the moment it lost focus, because the non-focused branch read
  # `meta().themeName` with no default fallback while the focused branch fell
  # back to the default name. With shuffle off (the test default) both tiles
  # sit on the default theme, so the non-focused tile must still show its pill.
  Scenario: Theme pill shows on every tile, including non-focused default-theme tiles
    When I create a terminal
    Then every canvas tile should show its theme pill

  Scenario: Each terminal has independent theme
    When I open the command palette
    And I select "Set theme" in the palette
    And I type "Dracula" in the palette
    And I press Enter
    Then the header should show theme "Dracula"
    # A new terminal inherits the active terminal's theme (the `inherit`
    # strategy — the deterministic test default), so it opens on Dracula.
    When I create a terminal
    Then the header should show theme "Dracula"
    # Re-theming the new terminal is independent — the original keeps Dracula.
    When I open the command palette
    And I select "Set theme" in the palette
    And I type "Nord" in the palette
    And I press Enter
    Then the header should show theme "Nord"
    # Entry 1 is the original terminal; it still carries its own Dracula.
    When I select workspace switcher entry 1
    Then the header should show theme "Dracula"

