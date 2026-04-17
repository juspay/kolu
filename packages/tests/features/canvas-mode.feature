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
    And I zoom the canvas in
    Then the canvas zoom level should have changed
    And the canvas tiles should be visible in the viewport
    And there should be no page errors

  Scenario: New terminal opens at viewport center
    When I click the canvas mode toggle
    And I create a terminal with keyboard shortcut
    Then there should be 2 canvas tiles
    And the newest canvas tile should be centered in the viewport

  Scenario: Scroll on terminal does not pan the canvas
    When I click the canvas mode toggle
    And I record the canvas transform
    And I scroll the wheel over the terminal tile
    Then the canvas transform should not have changed
    And there should be no page errors

  Scenario: Scroll on canvas background pans the canvas
    When I click the canvas mode toggle
    And I record the canvas transform
    And I scroll the wheel over the canvas background
    Then the canvas transform should have changed
    And there should be no page errors

  Scenario: Canvas-owned scroll does not leak into a terminal
    When I click the canvas mode toggle
    And I scroll the wheel over the canvas background
    And I scroll the wheel over the terminal tile within the idle window
    Then xterm should not have received a wheel event
    And there should be no page errors

  Scenario: Shift + wheel over terminal pans the canvas
    When I click the canvas mode toggle
    And I record the canvas transform
    And I Shift+scroll the wheel over the terminal tile
    Then the canvas transform should have changed
    And there should be no page errors

  Scenario: Shift + primary drag over terminal pans the canvas
    When I click the canvas mode toggle
    And I record the canvas transform
    And I Shift+drag from inside the terminal tile
    Then the canvas transform should have changed
    And there should be no page errors

  Scenario: Minimap shows zoom bar in canvas mode
    When I click the canvas mode toggle
    Then the minimap should be visible
    And the minimap toggle button should be visible
    And there should be no page errors

  Scenario: Minimap expands with multiple terminals
    Given I create a terminal
    And I create a terminal
    When I click the canvas mode toggle
    Then the minimap map should be visible
    And there should be no page errors

  Scenario: Minimap toggle collapses and expands the map
    Given I create a terminal
    And I create a terminal
    When I click the canvas mode toggle
    Then the minimap map should be visible
    When I click the minimap toggle
    Then the minimap map should not be visible
    When I click the minimap toggle
    Then the minimap map should be visible
    And there should be no page errors

  Scenario: Minimap viewport rect drag pans the canvas
    Given I create a terminal
    And I create a terminal
    When I click the canvas mode toggle
    And I save the canvas viewport state
    And I drag the minimap viewport rect
    Then the canvas viewport state should have changed
    And there should be no page errors

  Scenario: Canvas tile positions persist across refresh
    When I click the canvas mode toggle
    And I move the canvas tile to x=320 y=420
    When I reload the page and wait for ready
    Then the canvas tile should be at x=320 y=420
    And there should be no page errors

  Scenario: WebGL context is held only by the focused tile
    Given I create a terminal
    When I click the canvas mode toggle
    Then there should be 2 canvas tiles
    And exactly 1 canvas tile should use the webgl renderer
    And the focused canvas tile should use the webgl renderer
    When I click canvas tile 1
    Then exactly 1 canvas tile should use the webgl renderer
    And the focused canvas tile should use the webgl renderer
    And there should be no page errors

  @mobile
  Scenario: Canvas mode toggle is hidden on mobile
    Then the canvas mode toggle should not be visible
    And there should be no page errors
