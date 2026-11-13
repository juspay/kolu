Feature: The Conductor reads as a conversation
  The chat is read in ONE COLUMN — the transcript, the status line and the
  composer at the same measure, with your own messages at that column's right
  edge rather than a screen away from the replies. On a window wide enough to
  hold that column and the watched panel side by side, the work in progress
  stands beside the conversation and is always on screen; below that width,
  and on a phone, it is the panel the status line's count opens. It is the
  SAME panel in both places, with the same Look open in it.

  Nothing in here reads `0`: a conversation watching nothing says nothing
  about counts, and there is no control that would open an empty list.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: The work in progress stands beside the conversation, and folds into the status line on a narrow window
    # ONE PANEL, TWO PLACEMENTS. The side column is not a second list — the
    # same component is drawn in the pane's second track on a wide window and
    # in a band above the status line on a narrow one, so there is exactly one
    # answer to "what is it working on" at any width.
    When I create a terminal
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    And the conductor side column should list the watched terminal
    When I resize the viewport to 900x768
    Then the conductor should have no side column
    And the watched terminals should be behind the status line's control
    When I resize the viewport to 1280x768
    Then the conductor side column should list the watched terminal
    And there should be no page errors

  Scenario: A Look stays open across the width where the two columns fold
    # The Look is the peek at a terminal's own screen, and what it has open is
    # a thing a person chose. A resize is a window changing size, not a reason
    # to close what they were reading — so the panel moving between its two
    # placements carries the open Look with it, both ways.
    #
    # The marker is COMPUTED by the shell so the command line's echo cannot
    # satisfy the Look: only the terminal's own screen can.
    When I create a terminal
    And I run "echo kolu-watch-$((6*7))"
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    When I look at the watched terminal
    Then the watched terminal's look should show "kolu-watch-42"
    When I resize the viewport to 900x768
    And I open the watched terminals
    Then the watched terminal's look should show "kolu-watch-42"
    When I resize the viewport to 1280x768
    Then the conductor side column should list the watched terminal
    And the watched terminal's look should show "kolu-watch-42"
    And there should be no page errors

  Scenario: With nothing in progress the side column says so, and no readout says zero
    # `watching 0` and `0 pieces of work` were readouts of nothing. The count
    # is absent, the control that would have opened an empty panel is absent,
    # and the side column — which stays on screen so the conversation does not
    # jump sideways when the first terminal appears — says what it is in one
    # quiet line instead.
    When I enter conductor mode
    Then the conductor status should say nothing is being watched
    And the conductor side column should say nothing is in progress
    And no count on screen should read zero
    And there should be no page errors

  @mobile
  Scenario: The phone keeps one column, and nothing reaches past its right edge
    # A phone is below the two-column width by definition, so the panel is the
    # one the count opens — and every part of the conversation stays inside
    # the 390px window.
    When I ask the conductor to watch the first terminal
    Then the conductor status should say it is watching 1
    And the conductor should have no side column
    And the watched terminals should be behind the status line's control
    When I open the watched terminals
    Then the watched panel should list the watched terminal
    And nothing on screen should reach past the window's right edge
    And there should be no page errors
