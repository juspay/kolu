Feature: The Conductor on a phone
  On the touch layout the Conductor owns the screen under the pull handle, and
  the pull-down chrome sheet is the phone's tab row: it opens from inside the
  conversation exactly as it does from a host, lists the Conductor first, and
  lights only the place you are in. A host chip in it is the way back.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  @mobile
  Scenario: From the Conductor, the chrome sheet takes you back to a host
    # The way out is the way in: the handle above the conversation opens the
    # same sheet a host view opens, and a host chip leaves the conversation.
    Then the conductor pane should be visible
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    And the mobile chrome sheet should put the conductor first, lit, and no host lit
    When I tap the local host chip
    Then the conductor pane should not be visible
    And there should be no page errors

  @mobile
  Scenario: An agent line on a phone stays inside the screen
    # A create card naming its terminal carries the longest title row in the
    # chat. On a phone it drops the raw tool-name chip and wraps rather than
    # clipping, so no element's right edge passes the window.
    When I ask the conductor to adopt the terminal
    Then the conductor transcript should show a "create" tool card
    And nothing on screen should reach past the window's right edge
    And there should be no page errors

  @mobile
  Scenario: On a phone a work chip in the chat brings out its card
    # Below the two-column width the work listing is a band the status line
    # opens. A chip on a turn opens that band and the work's card in it, so
    # the way from a reply to its work is one tap on a phone too.
    Given a repo for the work
    When I ask the conductor to open the work "the phone's work"
    And I press the work's chip in the conversation
    Then the watched work's card should be open
    And there should be no page errors

  @mobile
  Scenario: On a phone a picked work is a page with a way back
    When I ask the conductor to watch the first terminal
    And I open the work column
    And I open the work card
    Then the watched work's card should be open
    And nothing on screen should reach past the window's right edge
    When I go back to all the works
    Then the phone should be showing the works
    And no work should be picked
    And there should be no page errors

  @mobile
  Scenario: On a phone a picked work offers its code, its tree scrolls and a file opens
    # The switch is the same on a phone: Code is offered, its tree is reached
    # by scrolling it, and a file opens in the view, all inside the window.
    Given a repo for the work
    When I ask the conductor to open the work "the phone's code"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes "plan.md" into the work's repo
    And the implementor writes 40 files into "." in the work's repo
    And I open the work column
    And I open the work card
    And I show the work's code
    Then the work's Code view should list "page-of-the-mockup-01.md" in its tree
    And the work's Code view should stand its tree above the file
    And the work's Code view tree should scroll down to "page-of-the-mockup-40.md"
    When I open "plan.md" in the work's Code view
    Then the work's Code view should show the markdown "Read the parser"
    And nothing on screen should reach past the window's right edge
    And there should be no page errors
