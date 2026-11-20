@claude-mock
Feature: Dock
  Left-edge canonical live-terminal navigator. Cards mode is the
  default — awaiting agents get full cards with a tail preview + reply
  input, working agents get compact pills, idle/parked terminals get
  faded one-liners. Rail mode collapses every row to a single colored
  swatch. Mega mode embeds the workspace search panel inline.

  Background:
    Given the terminal is ready

  Scenario: Dock defaults to cards mode on first open
    Then the dock should be visible
    And the dock should default to cards mode

  Scenario: Dock surfaces an awaiting-input Claude session as a full card
    When a Claude Code session is mocked with state "awaiting_user"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 card

  Scenario: Dock surfaces a just-finished (waiting) Claude session as a quiet row, not a card
    When a Claude Code session is mocked with state "waiting"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 0 cards
    And the dock should show 0 working pills

  Scenario: Dock surfaces working Claude session as a compact pill
    When a Claude Code session is mocked with state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 0 cards
    And the dock should show 1 working pill

  Scenario: Dock collapses to rail and expands back to cards
    When I collapse the dock to rail
    Then the dock should be in "rail" mode
    When the dock is expanded
    Then the dock should be in "cards" mode

  Scenario: Cmd+Shift+B toggles the dock between rail and cards
    When I press the dock toggle shortcut
    Then the dock should be in "rail" mode
    When I press the dock toggle shortcut
    Then the dock should be in "cards" mode

  Scenario: Chrome-bar dock-toggle button toggles the dock
    When I click the chrome-bar dock toggle
    Then the dock should be in "rail" mode
    When I click the chrome-bar dock toggle
    Then the dock should be in "cards" mode

  Scenario: Dock stays visible in maximized-tile mode as a sidebar
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    And the dock should be visible
    And the dock should be in maximized mode

  Scenario: Foreground process surfaces on non-agent dock rows
    When I start "sleep 5"
    Then the dock should show 1 foreground row containing "sleep"

  Scenario: A dock row names the model its agent is running on
    When a Claude Code session is mocked with state "tool_use"
    Then the dock should show 1 working pill
    And the dock row should name the model "claude-opus-4-6"

  Scenario: The model tag survives a turn the agent is still running
    When a Claude Code session is mocked with state "thinking_after_reply"
    Then the dock should show 1 working pill
    And the dock row should name the model "claude-opus-4-6"

  Scenario: A split's dock row is indented inside its parent's box
    When I create a sub-terminal via command palette
    Then the dock should show 1 split sub-entry
    And the split's dock row should sit inside its parent row's box
    And there should be no page errors

  Scenario: Cmd+1 activates the first dock row (creation order)
    Given I run "echo first-dock-row"
    And I create a terminal
    When I press shortcut "Mod+1"
    Then the active terminal should show "first-dock-row"

  Scenario: A blocked agent joins the Needs-you strip without renumbering the dock
    Given I run "echo first-dock-row"
    And I create a terminal
    When a Claude Code session is mocked with state "awaiting_user"
    Then the dock needs-you strip should show 1 entry
    When I press shortcut "Mod+1"
    Then the active terminal should show "first-dock-row"
    And there should be no page errors

  Scenario: Mod held reveals numeric shortcut hints on dock rows
    Given I create a terminal
    Then no dock-row shortcut hints should be visible
    When I press and hold Mod
    Then the dock should show 2 shortcut hints
    When I release Mod
    Then no dock-row shortcut hints should be visible

  Scenario: Repo sections carry a colour spine and a sticky tinted header
    Given I create a terminal
    When the dock is expanded
    Then the dock section should carry a repo-colour spine
    And the dock section header should be sticky

  Scenario: Dock activity-window selector defaults to All and shares with the minimap
    Then the dock window trigger should be visible
    And the dock window should be "all"
    And the minimap window should be "all"
    When I click the dock window trigger
    And I pick the dock window option "12h"
    Then the dock window should be "12h"
    And the minimap window should be "12h"
    And there should be no page errors

  Scenario: Activity-window footer switches layout reactively on collapse
    Then the dock hidden footer should use the "cards" layout
    When I collapse the dock to rail
    Then the dock should be in "rail" mode
    And the dock hidden footer should use the "rail" layout
    When the dock is expanded
    Then the dock hidden footer should use the "cards" layout
    And there should be no page errors

  Scenario: The resize handle exists only in the maximized cards sidebar; drag widens and persists, double-click resets
    Given I create a terminal
    Then the dock resize handle should not be present
    When I click the chrome-bar maximize toggle
    Then the dock should be in maximized mode
    And the dock resize handle should be visible
    When I collapse the dock to rail
    Then the dock resize handle should not be present
    When the dock is expanded
    Then the dock resize handle should be visible
    When I drag the dock resize handle right by 140 pixels
    Then the dock should be wider than before
    And the resized dock width should be persisted
    When I double-click the dock resize handle
    Then the dock should return to its default width
    And there should be no page errors

  Scenario: The maximized dock reserves canvas room so its handle stays reachable
    Given I create a terminal
    When I click the chrome-bar maximize toggle
    And I shrink the viewport to 760 pixels wide
    Then the dock should be in maximized mode
    When I drag the dock resize handle right by 600 pixels
    Then the dock resize handle should stay within the viewport
    And the canvas beside the dock should stay at least 150 pixels wide
    And there should be no page errors

  Scenario: A cancelled dock resize drag reverts to the pre-drag width
    Given I create a terminal
    When I click the chrome-bar maximize toggle
    Then the dock should be in maximized mode
    And the dock resize handle should be visible
    When I start a dock resize drag and the browser cancels it
    Then the dock width should return to its pre-drag value
    And there should be no page errors
