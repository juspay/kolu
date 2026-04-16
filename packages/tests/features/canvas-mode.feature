Feature: Canvas mode
  Terminals can be displayed on a freeform 2D canvas instead of the default
  focus mode. Toggle via the grid icon in the header. Canvas mode is
  desktop-only — mobile devices always use focus mode.

  Background:
    Given the terminal is ready

  Scenario: Canvas mode toggle is visible on desktop
    Then the canvas mode toggle should show "Focus"
    And there should be no page errors

  Scenario: Switch to canvas mode via header toggle
    When I click the canvas mode toggle
    Then the canvas mode toggle should show "Canvas"
    And the canvas grid background should be visible
    And there should be no page errors

  Scenario: Switch back to focus mode
    When I click the canvas mode toggle
    Then the canvas mode toggle should show "Canvas"
    When I click the canvas mode toggle
    Then the canvas mode toggle should show "Focus"
    And the canvas grid background should not be visible
    And there should be no page errors

  Scenario: Canvas mode shows terminal as a tile
    When I click the canvas mode toggle
    Then there should be 1 canvas tile
    And the canvas tile should have a title bar
    And there should be no page errors

  Scenario: Multiple terminals render as separate tiles
    Given I create a terminal
    When I click the canvas mode toggle
    Then there should be 2 canvas tiles
    And there should be no page errors

  Scenario: Canvas tile has a close button
    When I click the canvas mode toggle
    Then there should be 1 canvas tile
    When I click the close button on canvas tile 1
    Then the close confirmation should be visible
    And there should be no page errors

  Scenario: Canvas mode preference persists across reload
    When I click the canvas mode toggle
    Then the canvas mode toggle should show "Canvas"
    When I reload the page and wait for ready
    Then the canvas mode toggle should show "Canvas"
    And the canvas grid background should be visible
    And there should be no page errors

  Scenario: Canvas opens scrolled to terminals
    When I click the canvas mode toggle
    Then the canvas tiles should be visible in the viewport
    And there should be no page errors

  Scenario: Canvas supports zoom via Ctrl+scroll
    When I click the canvas mode toggle
    Then the canvas container should have zoom level 1
    When I zoom the canvas in
    Then the canvas container should have zoom level greater than 1
    And the canvas tiles should be visible in the viewport
    And there should be no page errors

  Scenario: Canvas fit-all keyboard shortcut
    Given I create a terminal
    When I click the canvas mode toggle
    Then there should be 2 canvas tiles
    When I zoom the canvas in
    When I press the fit-all shortcut
    Then the canvas tiles should be visible in the viewport
    And there should be no page errors

  @mobile
  Scenario: Canvas mode toggle is hidden on mobile
    Then the canvas mode toggle should not be visible
    And there should be no page errors
