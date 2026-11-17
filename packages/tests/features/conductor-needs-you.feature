Feature: The works that need you come first, and the chat goes quiet
  A piece of work is somewhere you can go and something you can talk about.
  `@` in the Conductor's box offers works before terminals, and a message
  that names one carries its chip. "About this work" points the chat at one
  work: the turns about anything else step aside, and what you send is about
  it. A reply to something kolu woke the Conductor with is one line until you
  open it. And the command palette lists the works, each row landing on its
  card through the same route a `#/work/…` link takes.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: `@` names a work, and the message carries its chip
    Given a repo for the work
    When I ask the conductor to open the work "rewrite the parser"
    And I type "@rewrite" in the conductor's box
    Then the mention menu should offer the work first
    When I take the first mention
    Then the conductor's box should carry the work as a mention
    When I send what is in the conductor's box
    Then my last message should carry the work's chip
    And there should be no page errors

  Scenario: "About this work" points the chat at one work, and the box with it
    Given a repo for the work
    When I ask the conductor to open the work "scope the chat"
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    When I press "About this work" on the work's card
    Then the chat should be about the work
    And my message "say hello" should be out of sight
    And the conductor's box should carry the work as the chat's scope
    When I send the conductor the prompt "and this"
    Then my last message should carry the work's chip
    When I show the whole chat
    Then my message "say hello" should be in sight
    And there should be no page errors

  Scenario: A reply to a wake is one line once something newer is said
    Given a repo for the work
    When I ask the conductor to open the work "fold the news"
    And I answer the work's question with "hand-over" on the card
    Then the newest wake's line should be open, saying "answered"
    When I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And the newest wake's line should be folded, saying "answered"
    When I open the newest wake's line
    Then the newest wake's line should be open, saying "answered"
    And there should be no page errors

  Scenario: The palette lists the works, and a row lands on the card
    Given a repo for the work
    When I ask the conductor to open the work "find it in the palette"
    And I leave the conductor for the host tab
    And I open the command palette
    And I type "find it in the palette" in the palette
    And I select "find it in the palette" in the palette
    Then the conductor pane should be visible
    And the watched work's card should be open
    And there should be no page errors
