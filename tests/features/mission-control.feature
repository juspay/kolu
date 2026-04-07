Feature: Mission Control
  Sticky ambient monitor for terminals running code agents.

  Background:
    Given the terminal is ready

  Scenario: Toggle via header icon shows and hides the strip
    When I click the Mission Control icon
    Then Mission Control should be visible
    When I click the Mission Control icon
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Toggle via keyboard shortcut
    When I press the Mission Control shortcut
    Then Mission Control should be visible
    When I press the Mission Control shortcut
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Toggle via command palette
    When I open the command palette
    And I type "Mission" in the palette
    And I press Enter
    Then Mission Control should be visible
    And there should be no page errors

  Scenario: Visibility persists across page reload
    When I click the Mission Control icon
    Then Mission Control should be visible
    When I reload the page and wait for ready
    Then Mission Control should be visible
    And there should be no page errors

  Scenario: Empty state when no code agents are running
    When I click the Mission Control icon
    Then Mission Control should be visible
    And Mission Control should show the empty state
    And there should be no page errors

  Scenario: Expand chevron reveals all terminals
    When I create a terminal
    And I click the Mission Control icon
    Then Mission Control should show the empty state
    When I click the Mission Control expand toggle
    Then Mission Control should show 2 terminal cards
    And there should be no page errors

  Scenario: Collapse chevron hides non-agent terminals again
    When I create a terminal
    And I click the Mission Control icon
    And I click the Mission Control expand toggle
    Then Mission Control should show 2 terminal cards
    When I click the Mission Control expand toggle
    Then Mission Control should show the empty state
    And there should be no page errors

  Scenario: Show-all state persists across reload
    When I click the Mission Control icon
    And I click the Mission Control expand toggle
    Then Mission Control should show 1 terminal card
    When I reload the page and wait for ready
    Then Mission Control should be visible
    And Mission Control should show 1 terminal card
    And there should be no page errors

  Scenario: Click card switches active terminal
    When I create a terminal
    And I run "echo mc-target"
    And I create a terminal
    And I click the Mission Control icon
    And I click the Mission Control expand toggle
    Then Mission Control should show 3 terminal cards
    When I click terminal card 2
    Then the active terminal should show "mc-target"
    And Mission Control should be visible
    And there should be no page errors

  Scenario: Ctrl+Tab jumps to previous terminal without any overlay
    When I create a terminal
    And I run "echo ctrl-tab-target"
    And I create a terminal
    And I press Ctrl+Tab
    Then Mission Control should not be visible
    And the active terminal should show "ctrl-tab-target"
    And there should be no page errors

  Scenario: Strip active card reflects current terminal
    When I create a terminal
    And I click the Mission Control icon
    And I click the Mission Control expand toggle
    Then Mission Control should have an active card
    And there should be no page errors
