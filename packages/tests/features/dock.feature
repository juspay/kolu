Feature: Dock — layout pin & visibility
  Kolu has one Dock component that renders two ways: canvas (spatial
  minimap on a 2D tile surface) and compact (vertical sidebar list).
  Layout is auto-picked from viewport width (≥1024px → canvas) and can
  be pinned via the header toggle. The dock itself can be hidden via
  Cmd+Shift+D, persisted per layout in localStorage.

  Tests default to `layoutPin: "compact"` so the sidebar's create-terminal
  button is on screen for `Given the terminal is ready`. Canvas-rendering
  scenarios live in `dock-canvas.feature` where the Background pins canvas
  before the first interaction.

  Background:
    Given the terminal is ready

  Scenario: Pin starts at compact (test default)
    Then the layout pin should be "compact"
    And the current layout should be "compact"
    And there should be no page errors

  Scenario: Cycle from compact reaches auto then canvas then back
    When I cycle the layout pin
    Then the layout pin should be "auto"
    When I cycle the layout pin
    Then the layout pin should be "canvas"
    When I cycle the layout pin
    Then the layout pin should be "compact"
    And there should be no page errors

  Scenario: Pin canvas explicitly switches the rendering
    When I pin the canvas layout
    Then the layout pin should be "canvas"
    And the current layout should be "canvas"
    And the canvas grid background should be visible
    And there should be no page errors

  Scenario: Pin compact hides the canvas
    When I pin the canvas layout
    And I pin the compact layout
    Then the canvas grid background should not be visible
    And there should be no page errors

  Scenario: Layout pin persists across reload
    When I pin the canvas layout
    When I reload the page and wait for ready
    Then the layout pin should be "canvas"
    And the current layout should be "canvas"
    And there should be no page errors

  Scenario: Toggle dock shortcut hides the compact dock
    Then the sidebar should be visible
    When I press the toggle dock shortcut
    Then the sidebar should not be visible
    When I press the toggle dock shortcut
    Then the sidebar should be visible
    And there should be no page errors

  @mobile
  Scenario: Mobile always renders compact
    Then the current layout should be "compact"

  @mobile
  Scenario: Layout pin toggle is hidden on mobile
    Then the layout pin toggle should not be visible
    And there should be no page errors
