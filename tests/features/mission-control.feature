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
