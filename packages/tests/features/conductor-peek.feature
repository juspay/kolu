Feature: Peek at a terminal from the Conductor

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: Look opens a live window that you can type in, and it does not resize the terminal
    When I leave the conductor for the host tab
    And I create a terminal
    And I run "echo size-$(stty size | tr ' ' x)"
    And I note the size the terminal printed
    And I ask the conductor to adopt the terminal I am in
    Then the conductor transcript should show a "create" tool card
    When I look at that tool card's terminal
    Then the peek should be open
    When I click the peek's terminal
    And I type "echo again-$(stty size | tr ' ' x)" into the peek
    Then the peek should show the noted size after "again-"
    And there should be no page errors

  Scenario: Esc belongs to the terminal while you type in it, and to the window otherwise
    When I leave the conductor for the host tab
    And I create a terminal
    And I ask the conductor to adopt the terminal I am in
    Then the conductor transcript should show a "create" tool card
    When I look at that tool card's terminal
    Then the peek should be open
    When I click the peek's terminal
    And I press Escape
    Then the peek should be open
    When I click the peek's bar
    And I press Escape
    Then the peek should not be open
    And the conductor pane should be visible
    And there should be no page errors

  Scenario: Take over and hand back from the peek
    Given a repo for the work
    When I ask the conductor to open the work "peek at the parser"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I look at the member terminal
    Then the peek should be open
    And the peek should list 1 tab
    And the peek's terminal should have come up
    And the peek should say the Conductor is driving
    When I type "sentinel-keys" into the peek
    Then the peek should not have heard "sentinel-keys"
    When I take over from the peek
    Then the peek should say you are driving
    And the peek should carry no hand-back pill
    When I type "sentinel-mine" into the peek
    Then the peek should have heard "sentinel-mine"
    When I hand back from the peek
    Then the peek should say the Conductor is driving
    When I type "sentinel-after" into the peek
    Then the peek should not have heard "sentinel-after"
    When I close the peek
    And I open the work card
    Then the work's timeline should show a "taken-over" event saying "You took over the implementor"
    And the work's timeline should show a "handed-back" event saying "You handed the implementor back"
    And there should be no page errors

  Scenario: Open tile leaves the Conductor for that terminal
    When I leave the conductor for the host tab
    And I create a terminal
    And I ask the conductor to adopt the terminal I am in
    Then the conductor transcript should show a "create" tool card
    When I look at that tool card's terminal
    Then the peek should be open
    When I open the peeked terminal's tile
    Then the peek should not be open
    And the conductor pane should not be visible
    And there should be no page errors

  Scenario: Typing at a terminal the Conductor drives offers Take over and sends nothing
    Given a repo for the work
    When I ask the conductor to open the work "type at the parser"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I look at the member terminal
    Then the peek should be open
    And the peek's terminal should have come up
    And the peek should say the Conductor is driving
    When I type "sentinel-first" on the keyboard
    Then the peek should offer to take over the "Implementor"
    And the peek should not have heard "sentinel-first"
    When I click the peek's bar
    And I type "sentinel-bar" on the keyboard
    Then the peek should offer to take over the "Implementor"
    And the peek should not have heard "sentinel-bar"
    When I take over from the peek's card
    Then the peek should say you are driving
    When I type "sentinel-mine" on the keyboard
    Then the peek should have heard "sentinel-mine"
    And there should be no page errors

  @mobile
  Scenario: On a phone the peek carries its own key bar once the terminal is yours
    Given a repo for the work
    When I ask the conductor to open the work "peek on a phone"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I look at the member terminal
    Then the peek should be open
    And the peek's terminal should have come up
    And the peek should carry no key bar
    When I take over from the peek
    Then the peek should say you are driving
    And the peek should carry the key bar
    When I type "sentinel-phone" into the peek
    Then the peek should have heard "sentinel-phone"
    And there should be no page errors

  Scenario: Switching to a terminal of another size does not move the peek's top bar
    Given a repo for the work
    When I ask the conductor to open the work "two sizes"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    And I enter conductor mode
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I look at the member terminal
    Then the peek should be open
    And the peek should list 2 tabs
    When I note where the peek's top bar is
    And I switch to the peek's other tab
    Then the peek's terminal should be a different size
    And the peek's top bar should not have moved
    And there should be no page errors
