Feature: The works that need you come first, and you can point the chat at one
  A piece of work is somewhere you can go and something you can talk about.
  `@` in the Conductor's box offers works before terminals, and a message
  that names one carries its chip. Picking a work points the chat at it: the
  turns about anything else step aside, and what you send is about it. And
  the command palette lists the works, each row landing on its card through
  the same route a `#/work/…` link takes.

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

  Scenario: Picking a work points the chat at it, and the box with it
    Given a repo for the work
    When I ask the conductor to open the work "scope the chat"
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    When I open the work card
    Then the chat should be about the work
    And my message "say hello" should be out of sight
    And the conductor's box should carry the work as the chat's scope
    When I send the conductor the prompt "and this"
    Then my last message should carry the work's chip
    When I show the whole chat
    Then my message "say hello" should be in sight
    And there should be no page errors

  Scenario: A reply to a wake stays on screen once something newer is said
    Given a repo for the work
    When I ask the conductor to open the work "the news"
    And I answer the work's question with "hand-over" on the card
    Then the reply to the newest wake should be on screen, saying "answered"
    When I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And the reply to the newest wake should be on screen, saying "answered"
    And there should be no page errors

  Scenario: A question about a work chimes wherever you are
    # THE BELL ON THE REAL PAGE. Three streams meet here: the works reading
    # the bell hears, the transcript row that draws the question in the chat,
    # and whether the Conductor is in front of you. Focus is declared, not
    # raced. A question chimes in every case — with the Conductor in front of
    # you it raises no desktop popup, and unfocused or on a host tab it does;
    # a page cannot show a test the popup, so only the sound is counted.
    #
    # 1. Focused, the chat in view: the setup question lands in front of you
    #    and still chimes.
    # 2. Unfocused: a second work asks, and it chimes.
    # 3. Focused again but on a host tab, the Conductor off screen: a third
    #    question, asked while the Conductor works through a long turn, chimes.
    Given a repo for the work
    And I stub the notification sound
    And I simulate the Kolu window regaining focus
    When I ask the conductor to open the work "quiet while in view"
    Then the work's question should be in the chat, its card shut
    And the notification sound should have played 1 time
    When I simulate the Kolu window losing focus
    And a repo for the work
    And I ask the conductor to open the work "ring when unfocused"
    Then the work's question should be in the chat, its card shut
    And the notification sound should have played 2 times
    When I simulate the Kolu window regaining focus
    And I send the conductor the prompt "work for a while"
    And I send the conductor the prompt "ask about the work"
    And I leave the conductor for the host tab
    Then the notification sound should have played 3 times
    And there should be no page errors

  Scenario: A reply to a message you typed rings once you have left the Conductor
    # In front of you a reply is not news: nothing plays. Leave for a host
    # tab while the Conductor is still working, and its reply chimes.
    Given I stub the notification sound
    And I simulate the Kolu window regaining focus
    When I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And the Conductor's bell should have had its frames to decide
    And the notification sound should have played 0 times
    When I send the conductor the prompt "work for a while"
    And I leave the conductor for the host tab
    Then the notification sound should have played 1 time
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

  Scenario: Picking a work shows it alone, with the others in a rail and the chat about it
    Given a repo for the work
    When I ask the conductor to open the work "the other one"
    And I ask the conductor to open the work "pick me"
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    When I open the work card
    Then the watched work's card should be open
    And the works rail should list "the other one" in one line
    And the chat should be about the work
    And my message "say hello" should be out of sight
    When I go back to all the works
    Then no work should be picked
    And the work column should show the work
    And my message "say hello" should be in sight
    And there should be no page errors

  Scenario: Showing the whole chat keeps the work picked
    Given a repo for the work
    When I ask the conductor to open the work "stay picked"
    And I open the work card
    Then the chat should be about the work
    When I show the whole chat
    Then the watched work's card should be open
    And there should be no page errors

  Scenario: Finished works are one line each, and one can be picked and reopened
    Given a repo for the work
    When I ask the conductor to open the work "done and dusted"
    And I answer the work's question with "merge" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I stop the work from the card
    Then the work should be finished as "stopped"
    And the finished work should be one line
    When I open the work card
    Then the watched work's card should be open
    And the work card should say it was stopped by you
    When I reopen the work from the card
    Then the work should be in progress
    And there should be no page errors

  Scenario: A reload stays on the picked work
    Given a repo for the work
    When I ask the conductor to open the work "still here"
    And I open the work card
    Then the watched work's card should be open
    When I reload the page and wait for ready
    And I enter conductor mode
    Then the watched work's card should be open
    And there should be no page errors
