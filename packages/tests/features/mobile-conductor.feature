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
    Then the conductor pane should be visible
    When I tap the mobile pull handle
    Then the mobile chrome sheet should be visible
    And the mobile chrome sheet should put the conductor first, lit, and no host lit
    When I tap the local host chip
    Then the conductor pane should not be visible
    And there should be no page errors

  @mobile
  Scenario: An agent line on a phone stays inside the screen
    When I ask the conductor to adopt the terminal
    Then the conductor transcript should show a "create" tool card
    And nothing on screen should reach past the window's right edge
    And there should be no page errors

  @mobile
  Scenario: On a phone a work chip in the chat brings out its card
    Given a repo for the work
    When I ask the conductor to open the work "the phone's work"
    And I press the work's chip in the conversation
    Then the watched work's card should be open
    And there should be no page errors
