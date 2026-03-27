Feature: Mission Control
  Bird's eye view dashboard of all terminals with live previews.

  Background:
    Given the terminal is ready

  Scenario: Open via header icon and close with Escape
    When I click the Mission Control icon
    Then Mission Control should be visible
    When I press Escape
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Open via command palette
    When I open the command palette
    And I type "Mission" in the palette
    And I press Enter
    Then Mission Control should be visible
    And there should be no page errors

  Scenario: Shows terminal cards
    When I create a terminal
    And I click the Mission Control icon
    Then Mission Control should be visible
    And Mission Control should show 2 terminal cards
    And there should be no page errors

  Scenario: Active terminal is highlighted
    When I click the Mission Control icon
    Then Mission Control should have an active card
    And there should be no page errors

  Scenario: Click card switches terminal
    When I create a terminal
    And I run "echo mc-second"
    And I create a terminal
    And I run "echo mc-third"
    And I click the Mission Control icon
    Then Mission Control should show 3 terminal cards
    When I click terminal card 1
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Terminal previews render
    When I click the Mission Control icon
    Then Mission Control should show terminal previews
    And there should be no page errors

  Scenario: Cards show number badges
    When I create a terminal
    And I click the Mission Control icon
    Then Mission Control card 1 should show number "1"
    And Mission Control card 2 should show number "2"
    And there should be no page errors

  Scenario: Press number key to switch terminal
    When I create a terminal
    And I run "echo mc-numkey"
    And I click the Mission Control icon
    Then Mission Control should show 2 terminal cards
    When I press 1
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Tab cycles through cards and wraps
    When I create a terminal
    And I click the Mission Control icon
    Then the active card should have focus
    # Active is card 2 (last created). Tab wraps forward.
    When I press Tab
    Then Mission Control card 1 should have focus
    When I press Tab
    Then Mission Control card 2 should have focus
    And there should be no page errors

  Scenario: Shift+Tab cycles backwards and wraps
    When I create a terminal
    And I click the Mission Control icon
    Then the active card should have focus
    # Active is card 2. Shift+Tab wraps backward.
    When I press Shift+Tab
    Then Mission Control card 1 should have focus
    When I press Shift+Tab
    Then Mission Control card 2 should have focus
    And there should be no page errors

  Scenario: Tab then Enter selects
    When I create a terminal
    And I click the Mission Control icon
    When I press Tab
    And I press Enter
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Arrow keys navigate the grid
    When I create a terminal
    And I click the Mission Control icon
    Then the active card should have focus
    When I press ArrowRight
    Then Mission Control card 2 should have focus
    When I press ArrowLeft
    Then Mission Control card 1 should have focus
    And there should be no page errors

  Scenario: Arrow key then Enter selects
    When I create a terminal
    And I click the Mission Control icon
    When I press ArrowRight
    And I press Enter
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Ctrl+Tab opens Mission Control with previous terminal focused
    When I create a terminal
    And I hold Ctrl and press Tab
    Then Mission Control should be visible
    # MRU: card 1 = current (terminal 2), card 2 = previous (terminal 1).
    # First Ctrl+Tab advances to card 2 (previous terminal).
    Then Mission Control card 2 should have focus
    And there should be no page errors

  Scenario: Quick Ctrl+Tab release switches to previous terminal
    When I create a terminal
    And I run "echo quick-switch-target"
    And I create a terminal
    # Currently on terminal 2 (last created). MRU: [term2, term1, background].
    # Quick Ctrl+Tab+release should switch to term1 (previous).
    When I hold Ctrl and press Tab
    When I release Ctrl
    Then Mission Control should not be visible
    And the active terminal should show "quick-switch-target"
    And there should be no page errors

  Scenario: Ctrl+Tab shows MRU order
    When I create a terminal
    And I run "echo mru-first"
    And I create a terminal
    And I run "echo mru-second"
    # Visit terminal 1 (explicitly created) to change MRU order
    And I select terminal 1 in the sidebar
    And I hold Ctrl and press Tab
    Then Mission Control should be visible
    # MRU: [term1, term2, background]. Card 2 = term2 (previous).
    Then Mission Control card 2 should have focus
    When I press Escape
    And there should be no page errors

  Scenario: Ctrl+Shift+Tab advances backward
    When I create a terminal
    And I hold Ctrl and Shift and press Tab
    Then Mission Control should be visible
    # With 2 terminals in MRU, backward from 0 wraps to last card
    Then the last Mission Control card should have focus
    And there should be no page errors

  Scenario: Open and close with keyboard shortcut
    When I press the Mission Control shortcut
    Then Mission Control should be visible
    When I press the Mission Control shortcut
    Then Mission Control should not be visible
    And there should be no page errors

  Scenario: Terminal focus restored after closing
    When I click the Mission Control icon
    Then Mission Control should be visible
    When I press Escape
    Then Mission Control should not be visible
    And the terminal should have keyboard focus
    And there should be no page errors

  Scenario: Many terminals fit on screen
    When I create a terminal
    And I create a terminal
    And I create a terminal
    And I create a terminal
    And I click the Mission Control icon
    Then Mission Control should show 5 terminal cards
    And all Mission Control cards should be visible
    And there should be no page errors

  Scenario: Click card switches to correct terminal
    When I create a terminal
    And I run "echo mc-target"
    And I create a terminal
    And I click the Mission Control icon
    When I click terminal card 2
    Then Mission Control should not be visible
    And the active terminal should show "mc-target"
    And there should be no page errors
