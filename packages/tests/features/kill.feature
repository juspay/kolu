Feature: Kill terminal
  Closing terminals via tile close button and auto-switching.

  Scenario: Closing a plain terminal asks for confirmation
    When I open the app
    And I create a terminal
    And I create a terminal
    And I click the tile close button for terminal 1
    Then the close confirmation should be visible
    When I cancel the close confirmation
    Then the pill tree should have 2 terminal entries
    And there should be no page errors

  Scenario: Kill terminal via tile close button
    When I open the app
    And I create a terminal
    And I run "echo kill-test-marker"
    And I create a terminal
    And I close terminal 1 via tile close button
    Then the pill tree should have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Kill active terminal auto-switches to next
    When I open the app
    And I create a terminal
    And I run "echo term-one"
    And I create a terminal
    And I run "echo term-two"
    And I create a terminal
    And I run "echo term-three"
    And I select terminal 2 in the pill tree
    And I close terminal 2 via tile close button
    Then the active terminal should show "term-three"
    And the pill tree should have 2 terminal entries
    And there should be no page errors

  Scenario: Kill last terminal shows empty state
    When I open the app
    And I create a terminal
    And I close terminal 1 via tile close button
    Then the empty state tip should be visible
    And the pill tree should have 0 terminal entries
    And there should be no page errors

  Scenario: Close terminal via command palette
    When I open the app
    And I create a terminal
    And I create a terminal
    And I close the active terminal via command palette
    Then the pill tree should have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Killed terminal stays gone after browser refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I close terminal 1 via tile close button
    Then the pill tree should have 1 terminal entry
    When I refresh the page
    Then the pill tree should have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Natural PTY exit removes terminal
    When I open the app
    And I create a terminal
    And I create a terminal
    And I select terminal 1 in the pill tree
    And I run "exit"
    Then the pill tree should eventually have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Natural exit stays gone after browser refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I select terminal 1 in the pill tree
    And I run "exit"
    Then the pill tree should eventually have 1 terminal entry
    When I refresh the page
    Then the pill tree should have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors
