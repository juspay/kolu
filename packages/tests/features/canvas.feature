Feature: Canvas workspace
  The desktop workspace is mode-less — terminals always render as freeform
  draggable tiles on an infinite 2D canvas. Mobile renders one fullscreen
  tile and disables the canvas entirely.

  Background:
    Given the terminal is ready

  Scenario: Canvas is the default desktop layout
    Then the canvas grid background should be visible
    And there should be 1 canvas tile
    And there should be no page errors

  Scenario: Canvas tile has a title bar
    Then the canvas tile should have a title bar
    And there should be no page errors

  Scenario: Canvas tile has a close button
    Then there should be 1 canvas tile
    When I click the close button on canvas tile 1
    Then the close confirmation should be visible
    And there should be no page errors

  Scenario: Multiple terminals render as separate tiles
    Given I create a terminal
    Then there should be 2 canvas tiles
    And there should be no page errors

  Scenario: Canvas opens scrolled to terminals
    Then the canvas tiles should be visible in the viewport
    And there should be no page errors

  Scenario: Canvas supports zoom via Ctrl+scroll
    When I zoom the canvas in
    Then the canvas zoom level should have changed
    And the canvas tiles should be visible in the viewport
    And there should be no page errors

  Scenario: New terminal opens at viewport center
    When I create a terminal with keyboard shortcut
    Then there should be 2 canvas tiles
    And the newest canvas tile should be centered in the viewport

  Scenario: Scroll on terminal does not pan the canvas
    When I record the canvas transform
    And I scroll the wheel over the terminal tile
    Then the canvas transform should not have changed
    And there should be no page errors

  Scenario: Scroll on canvas background pans the canvas
    When I record the canvas transform
    And I scroll the wheel over the canvas background
    Then the canvas transform should have changed
    And there should be no page errors

  Scenario: Canvas-owned scroll does not leak into a terminal
    When I scroll the wheel over the canvas background
    And I scroll the wheel over the terminal tile within the idle window
    Then xterm should not have received a wheel event
    And there should be no page errors

  Scenario: Shift + wheel over terminal pans the canvas
    When I record the canvas transform
    And I Shift+scroll the wheel over the terminal tile
    Then the canvas transform should have changed
    And there should be no page errors

  Scenario: Shift + primary drag over terminal pans the canvas
    When I record the canvas transform
    And I Shift+drag from inside the terminal tile
    Then the canvas transform should have changed
    And there should be no page errors

  Scenario: Minimap shows zoom bar on the canvas
    Then the minimap should be visible
    And the minimap toggle button should be visible
    And there should be no page errors

  Scenario: Minimap expands with multiple terminals
    Given I create a terminal
    And I create a terminal
    Then the minimap map should be visible
    And there should be no page errors

  Scenario: Minimap toggle collapses and expands the map
    Given I create a terminal
    And I create a terminal
    Then the minimap map should be visible
    When I click the minimap toggle
    Then the minimap map should not be visible
    When I click the minimap toggle
    Then the minimap map should be visible
    And there should be no page errors

  Scenario: Minimap viewport rect drag pans the canvas
    Given I create a terminal
    And I create a terminal
    When I save the canvas viewport state
    And I drag the minimap viewport rect
    Then the canvas viewport state should have changed
    And there should be no page errors

  Scenario: Clicking a minimap tile rect activates that terminal and pans the canvas
    Given I create a terminal
    And I create a terminal
    When I click canvas tile 2
    And I save the canvas viewport state
    And I click minimap tile rect 3
    Then the canvas viewport state should have changed
    And canvas tile 3 should be the active tile
    And there should be no page errors

  Scenario: Canvas tile positions persist across refresh
    When I move the canvas tile to x=320 y=420
    When I reload the page and wait for ready
    Then the canvas tile should be at x=320 y=420
    And there should be no page errors

  Scenario: WebGL context is held only by the focused tile
    Given I create a terminal
    Then there should be 2 canvas tiles
    And exactly 1 canvas tile should use the webgl renderer
    And the focused canvas tile should use the webgl renderer
    When I click canvas tile 1
    Then exactly 1 canvas tile should use the webgl renderer
    And the focused canvas tile should use the webgl renderer
    And there should be no page errors

  Scenario: Double-clicking the title bar maximizes the tile
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    When I double-click the title bar of canvas tile 1
    Then no canvas tile should be maximized
    And there should be no page errors

  @mobile
  Scenario: Canvas is not rendered on mobile
    Then the canvas grid background should not be visible
    And the mobile tile view should be visible
    And there should be no page errors
