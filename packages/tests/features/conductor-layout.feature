Feature: The Conductor reads as a conversation
  The chat is read in ONE COLUMN — the transcript, the status line and the
  composer at the same measure, with your own messages at that column's right
  edge rather than a screen away from the replies. On a window wide enough to
  hold that column and the work beside it, the work in progress stands next to
  the conversation and is always on screen; below that width, and on a phone,
  it is the column the status line's count opens. It is the SAME column in
  both places, with the same card open in it. On a window wider still the help
  is a third track at the head of the frame, collapsible into a rail and
  remembered; everywhere else it is one entry in the `⋯` menu.

  Nothing in here reads `0`: a conversation with no work in progress says
  nothing about counts, and there is no control that would open an empty
  column.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: The work stands beside the conversation, and folds into the status line on a narrow window
    When I create a terminal
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    And the conductor side column should show the work
    When I resize the viewport to 900x768
    Then the conductor should have no side column
    And the work column should be behind the status line's control
    When I resize the viewport to 1280x768
    Then the conductor side column should show the work
    And there should be no page errors

  Scenario: A Look stays open across the width where the two columns fold
    When I leave the conductor for the host tab
    And I create a terminal
    And I run "echo kolu-watch-$((6*7))"
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When I open the work card
    And I look at the member terminal
    Then the member terminal's look should show "kolu-watch-42"
    When I resize the viewport to 900x768
    And I open the work column
    Then the member terminal's look should show "kolu-watch-42"
    When I resize the viewport to 1280x768
    Then the conductor side column should show the work
    And the member terminal's look should show "kolu-watch-42"
    And there should be no page errors

  Scenario: With nothing in progress the column says so, and no readout says zero
    When I enter conductor mode
    Then the conductor status should say nothing is in progress
    And the work column should say nothing is in progress
    And no count on screen should read zero
    And there should be no page errors

  @mobile
  Scenario: The phone keeps one column, and nothing reaches past its right edge
    When I ask the conductor to watch the first terminal
    Then the conductor status should say 1 piece of work
    And the conductor should have no side column
    And the work column should be behind the status line's control
    When I open the work column
    Then the work column should show the work
    And nothing on screen should reach past the window's right edge
    And there should be no page errors

  Scenario: The help is the third track, and what you shut stays shut
    When I resize the viewport to 1440x900
    Then the conductor help column should be open
    And the help column should teach the conversation, docs and all
    And the conductor menu should not offer How to use
    When I collapse the conductor help
    Then the conductor help column should be a rail with one way back in
    When I reload the page and wait for ready
    And I enter conductor mode
    Then the conductor help column should be a rail with one way back in
    When I reopen the conductor help
    Then the conductor help column should be open
    When I resize the viewport to 1280x768
    Then the conductor should have no help column
    When I open How to use from the conductor menu
    Then the help sheet should be open
    And the help sheet should teach the conversation, docs and all
    And there should be no page errors

  @mobile
  Scenario: The phone reaches the same words from the menu, inside its 390px
    Then the conductor should have no help column
    When I open How to use from the conductor menu
    Then the help sheet should be open
    And the help sheet should teach the conversation, docs and all
    And nothing on screen should reach past the window's right edge
    And there should be no page errors
