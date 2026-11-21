Feature: The Conductor reads as a conversation
  The works take the wide side of the screen and the conversation is a panel
  on the right, at every desktop width: every work and every terminal stays on
  screen, and the chat is read at its own measure beside them. On a phone they
  are two tabs, Work and Chat, one on screen at a time. The help is a sheet,
  one press away behind the `?` in the header and the `⋯` menu's How to use.

  Nothing in here reads `0`: a conversation with no work in progress says
  nothing about counts, and there is no control that would open an empty
  list.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: The works take the wide side and the conversation stays beside them, at every desktop width
    # ONE FRAME AT EVERY DESKTOP WIDTH: the works have the room that is left
    # and the conversation a panel of fixed measure on the right — nothing
    # folds away on a narrow window, and nothing is left unused on a wide one.
    When I create a terminal
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    And the work column should show the work
    And the conversation should be a panel on the right of the works
    When I resize the viewport to 900x768
    Then the work column should show the work
    And the conversation should be a panel on the right of the works
    And nothing on screen should reach past the window's right edge
    When I resize the viewport to 2000x1100
    Then the work column should show the work
    And the works and the conversation should fill the window's width
    And there should be no page errors

  Scenario: The peek stays open across a resize
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
    Then the member terminal's look should show "kolu-watch-42"
    When I resize the viewport to 1280x768
    Then the member terminal's look should show "kolu-watch-42"
    And there should be no page errors

  Scenario: With nothing in progress the column says so, and no readout says zero
    # `watching 0` and `0 pieces of work` were readouts of nothing. The count
    # is absent, the control that would have opened an empty column is absent,
    # and the column — which stays on screen so the conversation does not jump
    # sideways when the first piece of work appears — says what it is in one
    # quiet line instead.
    When I enter conductor mode
    Then the conductor status should say nothing is in progress
    And the work column should say nothing is in progress
    And no count on screen should read zero
    And there should be no page errors

  @mobile
  Scenario: The phone shows the conversation or the works, one at a time
    # A phone has no side to stand anything beside, so the works and the
    # conversation are two tabs. It opens on the conversation; the status
    # line's count is the way to the works, and the Chat tab the way back.
    When I ask the conductor to watch the first terminal
    Then the conductor status should say 1 piece of work
    And the phone should be showing the conversation
    And the work column should be behind the status line's control
    When I open the work column
    Then the phone should be showing the works
    And the work column should show the work
    And nothing on screen should reach past the window's right edge
    When I tap the phone's Chat tab
    Then the phone should be showing the conversation
    And there should be no page errors

  Scenario: The help opens from the question mark, at every width
    # The words are short enough to read whole on a laptop: six sections and
    # nothing to scroll. The `?` is in the header at every desktop width, so a
    # narrow window reaches the help the way a wide one does.
    When I resize the viewport to 1440x900
    And I open the conductor help
    Then the help sheet should be open
    And the help sheet should teach the conversation, docs and all
    And the help sheet should fit without scrolling
    When I press Escape
    Then the help sheet should not be open
    And the conductor pane should be visible
    When I resize the viewport to 900x768
    And I open the conductor help
    Then the help sheet should be open
    And there should be no page errors

  @mobile
  Scenario: The phone reaches the same words from the menu, inside its 390px
    # A phone's header has no `?`, so the one entry in the `⋯` menu opens the
    # SAME words as a sheet, and the sheet stays inside the window like
    # everything else in the conversation.
    When I open How to use from the conductor menu
    Then the help sheet should be open
    And the help sheet should teach the conversation, docs and all
    And nothing on screen should reach past the window's right edge
    And there should be no page errors

  Scenario: A long column of works scrolls by itself, and the pane never does
    When I resize the viewport to 1440x500
    And I ask the conductor to open the work "one"
    And I ask the conductor to open the work "two"
    And I ask the conductor to open the work "three"
    And I ask the conductor to open the work "four"
    And I ask the conductor to open the work "five"
    And I ask the conductor to open the work "six"
    Then the work column should be taller than its window
    And only the work column should scroll
    And there should be no page errors

  Scenario: Esc closes the help sheet and stays in the Conductor
    When I open How to use from the conductor menu
    Then the help sheet should be open
    When I press Escape
    Then the help sheet should not be open
    And the conductor pane should be visible
    And there should be no page errors

  Scenario: Esc closes the command palette and stays in the Conductor
    When I open the command palette
    Then the command palette should be visible
    When I press Escape
    Then the command palette should not be visible
    And the conductor pane should be visible
    And there should be no page errors
