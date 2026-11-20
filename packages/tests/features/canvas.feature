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

  Scenario: New terminal opens centered without moving the existing tile
    When I record all canvas tile positions
    And I scroll the wheel over the canvas background
    And I create a terminal with keyboard shortcut
    Then there should be 2 canvas tiles
    And previously-recorded canvas tiles should not have moved
    And the newest canvas tile should be centered in the viewport

  Scenario: Creating a terminal leaves hand-placed terminals exactly where they are (regression)
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I move every canvas tile to a distinct scattered position
    And I record all canvas tile positions
    And I create a terminal with keyboard shortcut
    Then there should be 5 canvas tiles
    And previously-recorded canvas tiles should not have moved
    And there should be no page errors

  Scenario: Each successive terminal create centers the viewport on the new active tile
    Then there should be 1 canvas tile
    When I create a terminal
    Then there should be 2 canvas tiles
    And the active canvas tile should be centered in the viewport
    When I create a terminal
    Then there should be 3 canvas tiles
    And the active canvas tile should be centered in the viewport
    When I create a terminal
    Then there should be 4 canvas tiles
    And the active canvas tile should be centered in the viewport
    When I create a terminal
    Then there should be 5 canvas tiles
    And the active canvas tile should be centered in the viewport

  Scenario: Ctrl+Tab cycle pans the canvas to the newly-active tile
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I press Control+Tab
    Then the active canvas tile should be centered in the viewport

  Scenario: Ctrl+Shift+] next-terminal pans the canvas to the newly-active tile
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I press Control+Shift+BracketRight
    Then the active canvas tile should be centered in the viewport

  Scenario: Selecting a workspace from the command palette pans the canvas to the newly-active tile
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I open the command palette
    And I select "Terminals" in the palette
    Then the workspace switcher panel should be visible
    When I click workspace switcher card 4
    Then the active canvas tile should be centered in the viewport

  Scenario: First terminal created on an emptied canvas is centered in the viewport
    Then there should be 1 canvas tile
    When I scroll the wheel over the canvas background
    Then the canvas transform should have changed
    When I click the close button on canvas tile 1
    Then the close confirmation should be visible
    When I confirm close all in the close confirmation
    Then there should be 0 canvas tiles
    When I create a terminal
    Then there should be 1 canvas tile
    And the active canvas tile should be centered in the viewport

  Scenario: Closing the active terminal pans the canvas to the auto-switched tile
    Given I create a terminal
    And I create a terminal
    Then there should be 3 canvas tiles
    When I close terminal 2 via tile close button
    Then there should be 2 canvas tiles
    And the active canvas tile should be centered in the viewport

  Scenario: Scroll on terminal does not pan the canvas
    Given the active canvas tile should be centered in the viewport
    When I record the canvas transform
    And I scroll the wheel over the terminal tile
    Then the canvas transform should not have changed
    And there should be no page errors

  Scenario: Scroll on canvas background pans the canvas
    Given the active canvas tile should be centered in the viewport
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

  Scenario: Minimap is always visible on the canvas
    Then the minimap should be visible
    And the minimap map should be visible
    And there should be no page errors

  Scenario: Minimap viewport rect drag pans the canvas
    Given I create a terminal
    And I create a terminal
    When I save the canvas viewport state
    And I drag the minimap viewport rect
    Then the canvas viewport state should have changed
    And there should be no page errors

  Scenario: Dragging a minimap tile rect moves the canvas tile
    Given I create a terminal
    And I create a terminal
    When I save canvas tile 1 position
    And I drag minimap tile rect 1 by x=24 y=18
    Then canvas tile 1 position should have changed
    And canvas tile 1 should be the active tile
    And there should be no page errors

  @skip
  Scenario: Clicking a minimap tile rect activates that terminal and pans the canvas
    Given I create a terminal
    And I create a terminal
    When I click canvas tile 2
    And I save the canvas viewport state
    And I click minimap tile rect 3
    Then the canvas viewport state should have changed
    And canvas tile 3 should be the active tile
    And there should be no page errors

  Scenario: Arrange canvas by repo repositions tiles
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I move the canvas tile to x=2400 y=1200
    Then the canvas tile should be at x=2400 y=1200
    When I save canvas tile 1 position
    And I open the command palette
    And I type "Arrange canvas by repo" in the palette
    And I select "Arrange canvas by repo" in the palette
    Then canvas tile 1 position should have changed
    And there should be no page errors

  Scenario: Arrange canvas centers the active tile and preserves which tile is active
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I move the canvas tile to x=4800 y=2400
    Then the canvas tile should be at x=4800 y=2400
    When I save the active canvas tile id
    And I open the command palette
    And I type "Arrange canvas by repo" in the palette
    And I select "Arrange canvas by repo" in the palette
    Then the saved active canvas tile should still be active
    And the active canvas tile should be centered in the viewport
    And there should be no page errors

  Scenario: Minimap window menu defaults to "All"
    Then the minimap window trigger should be visible
    And the minimap window should be "all"
    And there should be no page errors

  Scenario: Picking a minimap window option persists across reload
    When I click the minimap window trigger
    And I pick the minimap window option "4h"
    Then the minimap window should be "4h"
    When I reload the page and wait for ready
    Then the minimap window should be "4h"
    When I click the minimap window trigger
    And I pick the minimap window option "all"
    Then the minimap window should be "all"
    And there should be no page errors

  Scenario: Minimap tile carries its agent bucket as a data attribute
    Then minimap tile 1 should be in the "none" bucket
    And there should be no page errors

  Scenario: Minimap arrange button repositions tiles
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I move the canvas tile to x=2400 y=1200
    Then the canvas tile should be at x=2400 y=1200
    When I save canvas tile 1 position
    And I click the minimap arrange button
    Then canvas tile 1 position should have changed
    And there should be no page errors

  Scenario: Minimap keeps its zoom controls visible when the canvas is tall and narrow
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I stack every canvas tile in a tall, narrow column
    Then the minimap zoom bar should not clip its controls
    And there should be no page errors

  Scenario: Creating a terminal after arrange leaves the arranged tiles in place
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I open the command palette
    And I type "Arrange canvas by repo" in the palette
    And I select "Arrange canvas by repo" in the palette
    And I record all canvas tile positions
    And I create a terminal with keyboard shortcut
    Then there should be 3 canvas tiles
    And previously-recorded canvas tiles should not have moved
    And there should be no page errors

  Scenario: Arrange twice in a row preserves the active tile (regression — #844)
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I save the active canvas tile id
    And I open the command palette
    And I type "Arrange canvas by repo" in the palette
    And I select "Arrange canvas by repo" in the palette
    Then the saved active canvas tile should still be active
    When I open the command palette
    And I type "Arrange canvas by repo" in the palette
    And I select "Arrange canvas by repo" in the palette
    Then the saved active canvas tile should still be active
    And there should be no page errors

  Scenario: Canvas tile positions persist across refresh
    When I move the canvas tile to x=320 y=420
    When I reload the page and wait for ready
    Then the canvas tile should be at x=320 y=420
    And there should be no page errors

  Scenario: WebGL is admitted to the whole working set under the context cap
    Given I create a terminal
    And I create a terminal
    Then there should be 3 canvas tiles
    And exactly 3 canvas tiles should use the webgl renderer
    And canvas tile 1 should use the webgl renderer
    When I click canvas tile 1
    Then exactly 3 canvas tiles should use the webgl renderer
    And canvas tile 1 should use the webgl renderer
    When I click canvas tile 2
    Then canvas tile 1 should use the webgl renderer
    And canvas tile 2 should use the webgl renderer
    And exactly 3 canvas tiles should use the webgl renderer
    And there should be no page errors

  Scenario: A held tile's active split inherits its WebGL renderer
    When I create a sub-terminal via command palette
    Then the sub-terminal should have keyboard focus
    And the focused sub-terminal should use the webgl renderer
    And the main terminal should use the webgl renderer
    And there should be no page errors

  Scenario: Renderer preference "webgl" forces WebGL on every tile
    Given I create a terminal
    And I create a terminal
    Then there should be 3 canvas tiles
    And exactly 3 canvas tiles should use the webgl renderer
    When I click the settings button
    Then the settings popover should be visible
    When I click the "webgl" renderer button
    Then exactly 3 canvas tiles should use the webgl renderer
    And there should be no page errors

  Scenario: Double-clicking the bare background of a populated canvas opens the new-terminal palette
    Then there should be 1 canvas tile
    When I double-click the empty canvas background
    Then the command palette should be visible
    And the palette breadcrumb should show "New terminal"
    And there should be no page errors

  Scenario: Double-clicking the zero-terminal welcome canvas opens the new-terminal palette
    Then there should be 1 canvas tile
    When I close the active terminal via command palette
    Then the empty state tip should be visible
    When I double-click the empty canvas background
    Then the command palette should be visible
    And the palette breadcrumb should show "New terminal"
    And there should be no page errors

  Scenario: Double-clicking a terminal tile does not open the new-terminal palette
    Then there should be 1 canvas tile
    When I double-click canvas tile 1
    Then the command palette should not be visible
    And there should be no page errors

  Scenario: Neither posture lets the page itself scroll
    Given I create a terminal
    Then the page should not scroll
    When I split terminal 1
    Then the page should not scroll
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    And the page should not scroll
    And there should be no page errors

  Scenario: A pinch outside the canvas never magnifies the page
    Given I create a terminal
    When I split terminal 1
    And I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    When I pinch over the dock
    Then the page should not be magnified
    And the page should not scroll
    And there should be no page errors

  Scenario: A pinch over a maximized tile leaves the canvas underneath it alone
    Given I create a terminal
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    When I record the canvas zoom level
    And I pinch over the maximized tile
    Then the canvas zoom level should not have changed
    And the page should not be magnified
    And there should be no page errors

  Scenario: A pinch inside a sandboxed HTML preview never magnifies the page
    When I run "rm -rf /tmp/kolu-pinch-html && git init /tmp/kolu-pinch-html && cd /tmp/kolu-pinch-html"
    And I run "printf '<!doctype html><h1>preview</h1>\n' > page.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "page.html" in the file browser
    Then the file preview iframe should be visible
    When I pinch over the file preview iframe
    Then the page should not be magnified
    And there should be no page errors

  Scenario: A magnified page does not shrink the app or refit its terminals
    When I snapshot the terminal grid
    And I force page magnification to 1.3
    Then the app root should fill the window
    And the terminal grid should match its snapshot
    And there should be no page errors

  Scenario: A small window does not make the page scroll in any posture
    Given I create a terminal
    When I resize the viewport to 853x480
    Then the page should not scroll
    When I split terminal 1
    Then the page should not scroll
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    And the page should not scroll
    And there should be no page errors

  Scenario: Double-clicking the title bar maximizes the tile
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    When I double-click the title bar of canvas tile 1
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Chrome-bar maximize toggle switches between canvas and maximized mode
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I click the chrome-bar maximize toggle
    Then canvas tile 1 should be maximized
    When I click the chrome-bar maximize toggle
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Keyboard shortcut toggles canvas maximize
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I press the maximize toggle shortcut
    Then canvas tile 1 should be maximized
    When I press the maximize toggle shortcut
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Command palette toggles canvas maximize with a state-reflecting label
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I open the command palette
    And I type "Maximize" in the palette
    And I select "Maximize terminal" in the palette
    Then canvas tile 1 should be maximized
    When I open the command palette
    And I type "Restore" in the palette
    And I select "Restore canvas" in the palette
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Switching the active terminal while maximized does not remount the xterm
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    When I tag canvas tile 2's xterm element
    And I press Control+Tab
    Then some canvas tile should be maximized
    And the tagged xterm element should still exist in the DOM
    And there should be no page errors

  Scenario: Covered tiles stay hidden in maximized mode
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I note every canvas tile's box
    And I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    Then every non-maximized canvas tile should be hidden
    And every covered canvas tile should keep the box it had
    And there should be no page errors

  Scenario: A tile parked off the canvas stops taking output until you look again
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I take over the page clock
    And I move canvas tile 1 far out of view
    Then the parked canvas tile should still be taking live output
    When the grace period passes
    Then the parked canvas tile should stop taking live output
    When I print a marker in the parked canvas tile
    Then the parked canvas tile should not show the marker
    When I move the parked canvas tile back into view
    Then the parked canvas tile should take live output again
    And the parked canvas tile should show the marker
    And there should be no page errors

  @mobile
  Scenario: Canvas is not rendered on mobile
    Then the canvas grid background should not be visible
    And the mobile tile view should be visible
    And there should be no page errors
