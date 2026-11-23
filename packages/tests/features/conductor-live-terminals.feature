Feature: A picked work's terminals, live

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A tile behind the Conductor does not take its terminal's size back
    # The terminal was looked at as a tile, so its tile is still attached
    # behind the Conductor. The work's pane sizes it, and the tile must not
    # size it back while the Conductor is in front. Open tile puts the canvas
    # in front, and the tile takes its size back; coming back, the pane does.
    Given a repo for the work
    When I resize the viewport to 2200x1200
    And I leave the conductor for the host tab
    And I create a terminal
    And I start a size recorder for the planner in the terminal I am in
    And I ask the conductor to open the work "watch them work"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the picked work should show 2 live terminals
    And the planner's program should be told its pane's size, and nothing else
    When I open the planner's tile from its live pane
    Then the planner's program should be told its tile's size
    When I go back to the conductor
    Then the planner's program should be told its pane's size, and nothing else
    And there should be no page errors

  Scenario: A terminal the Conductor starts fills its pane
    Given a repo for the work
    When I resize the viewport to 2200x1200
    And I ask the conductor to open the work "fill the pane"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run a size recorder as the implementor in the work's repo
    And I open the work card
    Then the picked work should show 1 live terminal
    And the implementor's program should be told one size larger than 80x24
    And the implementor live pane should show the size its program was told
    And the "implementor" live pane should not pan
    And there should be no page errors

  Scenario: A work's pane tells its terminal its size once
    # Switching views and Take over / Hand back are not reasons to speak: the
    # pane asks for the size the terminal already has, and a same-size resize
    # tells the program nothing.
    Given a repo for the work
    When I resize the viewport to 2200x1200
    And I ask the conductor to open the work "told once"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run a size recorder as the implementor in the work's repo
    And I open the work card
    Then the implementor's program should be told one size larger than 80x24
    When I show the work's details
    And I show the work's terminals
    And I take over the "implementor" in its live terminal
    And I hand back the "implementor" in its live terminal
    Then the implementor's program should be told nothing more
    And there should be no page errors

  Scenario: A work's pane tells its terminal a new size when the window changes
    Given a repo for the work
    When I resize the viewport to 2200x1200
    And I ask the conductor to open the work "a new window"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run a size recorder as the implementor in the work's repo
    And I open the work card
    Then the implementor's program should be told one size larger than 80x24
    When I resize the viewport to 1800x1100
    Then the implementor's program should be told one new size
    And the implementor live pane should show the size its program was told
    And there should be no page errors

  Scenario: Resizing the window while scrolled back keeps the view where it was
    # The new size waits behind the output the reader has not seen, and is
    # applied when they return to the bottom: the view does not move.
    Given a repo for the work
    When I resize the viewport to 2200x1200
    And I ask the conductor to open the work "resize while reading"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the picked work should show 1 live terminal
    When I take over the "implementor" in its live terminal
    And I type "fill-scrollback" into the "implementor" live terminal
    Then the "implementor" live terminal should show "omp-line 300"
    When I wheel back over the "implementor" live terminal
    And I resize the viewport to 1800x1100
    Then the "implementor" live terminal should stay scrolled back
    When I wheel to the bottom of the "implementor" live terminal
    Then the "implementor" live terminal should be live at the bottom
    And there should be no page errors

  Scenario: A work's pane never tells its terminal less than 80x24
    # Two stacked panes on a 1440x900 window are each narrower than 80
    # columns and shorter than 24 rows; each asks for 80x24 at the least.
    Given a repo for the work
    When I resize the viewport to 1440x900
    And I leave the conductor for the host tab
    And I create a terminal
    And I start a size recorder for the planner in the terminal I am in
    And I ask the conductor to open the work "a small window"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I ask the conductor to run a size recorder as the implementor in the work's repo
    And I open the work card
    Then the picked work should show 2 live terminals
    And no recorded program should be told less than 80x24
    And there should be no page errors

  Scenario: A dropped connection behind the Conductor tells a work's terminal nothing
    # The tile of a terminal that was looked at stays attached behind the
    # Conductor. When the connection drops and comes back its stream is
    # re-subscribed, and must not carry the tile's size back.
    Given a repo for the work
    When I resize the viewport to 2200x1200
    And I leave the conductor for the host tab
    And I create a terminal
    And I start a size recorder for the planner in the terminal I am in
    And I ask the conductor to open the work "a dropped connection"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I open the work card
    Then the picked work should show 1 live terminal
    And the planner's program should be told its pane's size, and nothing else
    When the WebSocket connection drops
    And the WebSocket connection is restored
    Then the connection status should eventually be "open"
    And the planner's program should be told nothing more
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

  Scenario: Scrolling back in a live terminal stays where you scrolled
    # Scrolling back holds the view and the head says "new output below" —
    # while the Conductor drives, and once the terminal is yours. A screen
    # that snapped back would re-attach and land on the newest line.
    Given a repo for the work
    When I ask the conductor to open the work "read back through it"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the picked work should show 1 live terminal
    When I take over the "implementor" in its live terminal
    And I type "fill-scrollback" into the "implementor" live terminal
    Then the "implementor" live terminal should show "omp-line 300"
    When I hand back the "implementor" in its live terminal
    Then the "implementor" live terminal should say the Conductor is driving
    When I wheel back over the "implementor" live terminal
    Then the "implementor" live terminal should stay scrolled back
    When I wheel to the bottom of the "implementor" live terminal
    Then the "implementor" live terminal should be live at the bottom
    When I take over the "implementor" in its live terminal
    And I wheel back over the "implementor" live terminal
    Then the "implementor" live terminal should stay scrolled back
    When I wheel to the bottom of the "implementor" live terminal
    Then the "implementor" live terminal should be live at the bottom
    And there should be no page errors

  Scenario: Shift+PageUp scrolls a live terminal back, and it stays
    Given a repo for the work
    When I ask the conductor to open the work "page back through it"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I open the work card
    Then the picked work should show 1 live terminal
    When I take over the "implementor" in its live terminal
    And I type "fill-scrollback" into the "implementor" live terminal
    Then the "implementor" live terminal should show "omp-line 300"
    When I press Shift+PageUp in the "implementor" live terminal
    Then the "implementor" live terminal should stay scrolled back
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

  @mobile
  Scenario: On a phone a work's pane leaves its terminal's size alone
    # A phone's pane follows: it draws the terminal at the size it has, and
    # Fit width shrinks it to the phone.
    Given a repo for the work
    When I ask the conductor to open the work "follow on a phone"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run a size recorder as the implementor in the work's repo
    And I open the work column
    And I open the work card
    Then the picked work should show 1 live terminal
    And the implementor's program should be told nothing more
    And the "implementor" live pane's Fit width should be lit
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
