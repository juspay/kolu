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
    # No auto-arrange on create: the new tile opens at the viewport-center
    # cascade and the existing tile stays exactly where it was. Repo
    # clustering happens ONLY via the explicit "Arrange canvas by repo".
    When I record all canvas tile positions
    And I scroll the wheel over the canvas background
    And I create a terminal with keyboard shortcut
    Then there should be 2 canvas tiles
    And previously-recorded canvas tiles should not have moved
    And the newest canvas tile should be centered in the viewport

  Scenario: Creating a terminal leaves hand-placed terminals exactly where they are (regression)
    # The core of this change: opening a new terminal must NOT auto-arrange.
    # We drag the existing terminals to arbitrary, off-grid spots first —
    # precisely so any re-layout would be detectable — then create a new
    # one. Every existing tile must stay byte-for-byte where it was put.
    # (Tiles left in auto-grid positions could be "rearranged" right back
    # onto themselves, which is why the old test proved nothing.)
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

  Scenario: Second terminal created at the default viewport is centered in the viewport
    # Regression: with no prior pan, creating a 2nd tile placed it next to
    # the existing tile but left the viewport centered on the original —
    # so the new (active) tile rendered half off-screen.
    Then there should be 1 canvas tile
    When I create a terminal
    Then there should be 2 canvas tiles
    And the active canvas tile should be centered in the viewport

  Scenario: Each successive terminal create centers the viewport on the new active tile
    # Reported by user with a 5-tile screenshot: after creating multiple
    # tiles in succession, the viewport stayed anchored on the original
    # tile while the active jumped to the latest. The active (last-created)
    # tile must end up centered, not just the first.
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
    # Reported by user: cycling with Ctrl+Tab (or Alt+Tab on macOS Chrome)
    # changed the active terminal but the viewport stayed put — the new
    # active tile could land off-screen entirely.
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I press Control+Tab
    Then the active canvas tile should be centered in the viewport

  Scenario: Cmd+1 positional switch pans the canvas to the newly-active tile
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I press Control+1
    Then the active canvas tile should be centered in the viewport

  Scenario: Ctrl+Shift+] next-terminal pans the canvas to the newly-active tile
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I press Control+Shift+BracketRight
    Then the active canvas tile should be centered in the viewport

  Scenario: Selecting a workspace from the command palette pans the canvas to the newly-active tile
    # Caught by hickey: the prior "Switch terminal" group spread
    # actionPaletteCommand then overrode onSelect with bare
    # setActiveId(id), stripping the centering the action handler
    # already does. After #912 the "Switch terminal" group became
    # "Search workspaces" with a column-grid body — picking a
    # workspace card calls store.activate(id), which still pans the
    # canvas to the newly-active tile.
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    Then there should be 4 canvas tiles
    When I open the command palette
    And I select "Search workspaces" in the palette
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

  # Viewport-pan assertion is flaky after the maximize signal landed
  # (sibling order in canvas-container changed; see Show wrapping the
  # Workspace switcher + minimap). The selection half of the behaviour is covered
  # by the workspace-switcher.feature scenarios.
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

  Scenario: Minimap window menu defaults to "24h"
    # Default activity window is now `24h` — see DEFAULT_ACTIVITY_WINDOW
    # in activityWindow.ts. The choice lives on a shared per-device
    # signal that the dock header reads from the same source, so the
    # default applies to both surfaces uniformly.
    Then the minimap window trigger should be visible
    And the minimap window should be "24h"
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
    # The renderer tags each rectangle with its bucket so attention-drawing
    # is testable without scraping CSS classes. A plain shell with no agent
    # attached lands in the "none" bucket.
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
    # A tall, narrow tile bounding box makes the minimap's shrink-to-fit
    # width collapse (the height constraint wins the scale). The panel must
    # still floor at the zoom bar's natural width, or overflow-hidden clips
    # the zoom-in / arrange / window controls off the right edge.
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I stack every canvas tile in a tall, narrow column
    Then the minimap zoom bar should not clip its controls
    And there should be no page errors

  Scenario: Creating a terminal after arrange leaves the arranged tiles in place
    # Arrange clusters the tiles; creating a terminal afterwards must NOT
    # re-arrange them — the new tile just opens at the cascade and the
    # arranged tiles keep their positions.
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

  Scenario: WebGL is budgeted to the 2 most-recently-active tiles
    # The budget holds WebGL on the 2 most-recently-active tiles (not just the
    # focused one), so ping-ponging between two terminals never crosses the
    # WebGL↔DOM boundary — the ~7.7% font reflow on focus swap is gone (#1403).
    Given I create a terminal
    And I create a terminal
    Then there should be 3 canvas tiles
    # 3 tiles, budget 2: the 2 newest hold WebGL, the oldest (tile 1) falls to DOM.
    And exactly 2 canvas tiles should use the webgl renderer
    And canvas tile 1 should use the dom renderer
    When I click canvas tile 1
    Then exactly 2 canvas tiles should use the webgl renderer
    And canvas tile 1 should use the webgl renderer
    When I click canvas tile 2
    # The key guarantee: switching to tile 2 leaves tile 1 on WebGL (under the old
    # N=1 policy it would have swapped to DOM here). Both ping-pong tiles stay WebGL.
    Then canvas tile 1 should use the webgl renderer
    And canvas tile 2 should use the webgl renderer
    And exactly 2 canvas tiles should use the webgl renderer
    And there should be no page errors

  Scenario: A held tile's active split inherits its WebGL renderer
    # A budgeted tile's renderer covers its main pane AND its active split, so
    # focusing into the split never drops the main pane to DOM — the 7.7%
    # divergence can't appear side-by-side inside one tile (#1403).
    When I create a sub-terminal via command palette
    Then the sub-terminal should have keyboard focus
    And the focused sub-terminal should use the webgl renderer
    And the main terminal should use the webgl renderer
    And there should be no page errors

  Scenario: Renderer preference "webgl" forces WebGL on every tile
    Given I create a terminal
    And I create a terminal
    Then there should be 3 canvas tiles
    # auto budgets WebGL to the 2 most-recently-active tiles (#1403)…
    And exactly 2 canvas tiles should use the webgl renderer
    When I click the settings button
    Then the settings popover should be visible
    When I click the "webgl" renderer button
    # …"webgl" overrides the budget and forces every tile onto WebGL.
    Then exactly 3 canvas tiles should use the webgl renderer
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
    # The header toggle is the always-visible affordance for the posture
    # switch (mirrors the dock/inspector toggles); drives the same
    # `useViewPosture.toggle` as the tile double-click.
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I click the chrome-bar maximize toggle
    Then canvas tile 1 should be maximized
    When I click the chrome-bar maximize toggle
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Keyboard shortcut toggles canvas maximize
    # Mod+Shift+M drives the same useViewPosture.toggle as the chrome-bar
    # button and the title-bar double-click — keyboard-first parity (#1242).
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I press the maximize toggle shortcut
    Then canvas tile 1 should be maximized
    When I press the maximize toggle shortcut
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Command palette toggles canvas maximize with a state-reflecting label
    # The palette command's label describes the action a select performs:
    # "Maximize terminal" when tiled, "Restore canvas" when maximized (#1243).
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
    # Regression for #988: switching active in maximized mode used to move
    # the active tile between the tiled `<For>` and a separate `<Show keyed>`
    # branch, forcing a full xterm.js remount (document.fonts.load wait,
    # XTerm constructor, addon graph, stream re-attach, server screenState
    # replay). Visible to users as ~200-500ms of blank/lag every switch.
    # The fix moves all tiles to one render list with pan/zoom composed
    # per-tile, so switching is a pure CSS class flip — the xterm DOM node
    # and its xterm.js Terminal instance survive across switches.
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
    # Regression for the new-terminal canvas flash: a covered tile must hide
    # itself (visibility:hidden), not rely on the active tile's z-40 cover
    # painting over it. When activeId points at a tile not yet in the render
    # list (e.g. a just-created terminal), no maximized z-40 tile exists, and
    # a covered tile that only carries inert/aria-hidden paints at its canvas
    # coords — the whole freeform canvas flashing for a frame (#989 dropped
    # the pre-#988 visibility:hidden). This asserts the intrinsic-hide
    # invariant that prevents the flash.
    Given I create a terminal
    Then there should be 2 canvas tiles
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    Then every non-maximized canvas tile should be hidden
    And every covered canvas tile should occupy the maximized tile's box
    And there should be no page errors

  @mobile
  Scenario: Canvas is not rendered on mobile
    Then the canvas grid background should not be visible
    And the mobile tile view should be visible
    And there should be no page errors
