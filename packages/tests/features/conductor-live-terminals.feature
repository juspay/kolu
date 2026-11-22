Feature: A picked work's terminals, live

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A picked work shows its terminals live, and does not resize them
    Given a repo for the work
    When I leave the conductor for the host tab
    And I create a terminal
    And I run "echo size-$(stty size | tr ' ' x)"
    And I note the size the terminal printed
    And I ask the conductor to open the work "watch them work"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the picked work should show 2 live terminals
    When I take over the "planner" in its live terminal
    And I type "echo again-$(stty size | tr ' ' x)" into the "planner" live terminal
    Then the "planner" live terminal should show the noted size after "again-"
    And there should be no page errors

  Scenario: Take over and hand back in a live terminal
    Given a repo for the work
    When I ask the conductor to open the work "drive it from the work"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the "implementor" live terminal should say the Conductor is driving
    When I type "sentinel-locked" on the keyboard
    Then the "implementor" live terminal should not have heard "sentinel-locked"
    When I take over the "implementor" in its live terminal
    And I type "sentinel-mine" on the keyboard
    Then the "implementor" live terminal should have heard "sentinel-mine"
    When I hand back the "implementor" in its live terminal
    Then the "implementor" live terminal should say the Conductor is driving
    And the work's timeline should show a "taken-over" event
    And the work's timeline should show a "handed-back" event
    And there should be no page errors

  Scenario: Fit width fits a wide terminal, and the choice survives a view switch
    # Fit width is on from the start and shared by every pane, so a wide
    # terminal opens fitted rather than as a sideways scroller. Pressing it
    # gives the terminal its own size back; a view switch does not reset it.
    Given a repo for the work
    When I leave the conductor for the host tab
    And I create a terminal
    And I ask the conductor to open the work "fit a wide terminal"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    And I resize the viewport to 1440x900
    Then the "implementor" live pane should not pan
    And the "implementor" live pane's Fit width should be lit
    When I press the "implementor" live pane's Fit width
    Then the "implementor" live pane should pan
    When I show the work's details
    And I show the work's terminals
    Then the "implementor" live pane should pan
    And there should be no page errors

  Scenario: A terminal that already fits is offered no Fit width
    # The button would have nothing to do, and turning the shared choice off
    # would then hide itself from this pane with no way back here.
    Given a repo for the work
    When I ask the conductor to open the work "already fits"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    And I resize the viewport to 2200x1200
    Then the "implementor" live pane should show no Fit width
    And there should be no page errors

  Scenario: More than two terminals are tabs, one live at a time
    Given a repo for the work
    When I ask the conductor to open the work "three of them"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I create a terminal
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I leave the conductor for the host tab
    And I create a terminal
    And I ask the conductor to join the terminal I am in to the work as its other
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the picked work should show 1 live terminal
    And the picked work should offer 3 terminal tabs
    And there should be no page errors

  Scenario: A work with no terminal up opens on its details
    Given a repo for the work
    When I ask the conductor to open the work "nothing running"
    And I open the work card
    Then the picked work should be showing its details
    And there should be no page errors

  @mobile
  Scenario: On a phone a picked work's terminal carries the key bar once it is yours
    Given a repo for the work
    When I ask the conductor to open the work "drive it on a phone"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I open the work column
    And I open the work card
    Then the picked work should show 1 live terminal
    And the live terminal should have no key bar
    When I take over the "implementor" in its live terminal
    Then the live terminal should have a key bar
    And there should be no page errors

  Scenario: Inspect unfolds a terminal in the details, and its Compose writes to that terminal
    # Inspect on a live pane opens the work's Details with that terminal's row
    # unfolded. The Compose there writes to that terminal on its own host,
    # through the same lock a keystroke asks.
    Given a repo for the work
    When I ask the conductor to open the work "compose from the work"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor's agent starts working
    And I open the work card
    Then the picked work should show 1 live terminal
    When I take over the "implementor" in its live terminal
    And I inspect the "implementor" in its live terminal
    Then the picked work should be showing its details
    And the "implementor" row should be unfolded, with its agent card and Compose
    When I send "composed-in-the-work" from the "implementor" row's Compose
    And I show the work's terminals
    Then the "implementor" live terminal should show "composed-in-the-work"
    And there should be no page errors
