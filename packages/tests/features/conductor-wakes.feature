Feature: The Conductor never blocks
  The Conductor does not sit in a wait while its agents work. It says what it
  is watching and ends its turn; kolu-server starts the next turn ITSELF when a
  watched terminal's agent stops, asks something, or the terminal dies. A wake
  that rings while the Conductor is busy is HELD and arrives when the turn
  ends. Every scenario runs against the scripted ACP adapter the harness points
  `KOLU_ACP_AGENT` at, and the terminals' agent states come from the same
  mocked Claude Code session files the agent-detection scenarios use — so the
  wake travels padi's urgency fold, kolu-server's watcher and the ACP wire
  exactly as a real one would.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A watched terminal whose agent asks wakes the idle Conductor
    # The wake is a MACHINE'S line: full width, one line saying who speaks,
    # and the whole account behind a disclosure. The agent answers it, which
    # is the proof the turn kolu started is a real turn.
    When I create a terminal
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    When the Claude Code session state changes to "awaiting_user"
    Then the conductor transcript should show a wake about the watched terminal
    And the wake should be one line from kolu
    When I open the wake
    Then the wake should give the whole account of the watched terminal
    And the conductor transcript should show a row of kind "agent" saying "woke"
    And there should be no page errors

  Scenario: An agent that comes up in a watched terminal rings once as ready
    # The seconds between a terminal and its agent are a fact with a name: a
    # watched terminal whose agent has come up and has not been spoken to yet
    # rings as READY — never as "stopped" about an agent nobody briefed.
    When I create a terminal
    And I note the terminal's shell pid
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    When a Claude Code session is mocked with state "waiting" on the noted terminal
    Then the conductor transcript should show a "ready" wake about the watched terminal
    And the conductor transcript should show a row of kind "agent" saying "woke"
    And there should be no page errors

  Scenario: A wake that rings while the Conductor works waits for the turn to end
    # HELD, never injected: the count on the status line says it is waiting,
    # nothing lands in the transcript while the turn runs, and it arrives on
    # its own the moment the turn ends.
    When I create a terminal
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    When I send the conductor the prompt "work for a while"
    Then the conductor status should read "working"
    When the Claude Code session state changes to "awaiting_user"
    Then the conductor status should say 1 waiting
    And the conductor transcript should show no wake
    And the conductor transcript should show a wake about the watched terminal
    And the conductor status should say nothing is waiting
    And there should be no page errors

  Scenario: The watched terminals are listed, looked at, and pressed to go there
    # The marker is COMPUTED by the shell so the command line's echo cannot
    # satisfy the Look: only the terminal's own screen can.
    #
    # ... and the row's NAME is the way to the terminal itself: the same
    # journey the create card's "open tile" makes — leave the conversation,
    # land on that terminal's tile — because it is the same code path.
    When I create a terminal
    And I run "echo kolu-watch-$((6*7))"
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    When I open the watched terminals
    Then the watched panel should list the watched terminal
    When I look at the watched terminal
    Then the watched terminal's look should show "kolu-watch-42"
    When I press the watched terminal's name
    Then the conductor pane should not be visible
    And the watched terminal should be the focused tile
    And there should be no page errors

  Scenario: Two pieces of work count on the tab, a split is drawn under its parent, and the badge says when it needs you
    # ONE BADGE on the Conductor's tab, like an unread count. The NUMBER is
    # how many pieces of work are in flight — a piece of work is the watched
    # terminals that share a top-level terminal, so a split of a watched
    # terminal joins ITS piece rather than starting one, and the panel draws it
    # UNDER that terminal (named as something a person recognises, never its
    # id) — and the COLOUR is whether the conversation is blocked on an answer
    # from you. Never a second count beside it.
    When I create a terminal
    And I ask the conductor to watch the terminal I just created
    Then the conductor status should say it is watching 1
    And the conductor status should say 1 piece of work
    When I ask the conductor to watch a split of the terminal I just created
    Then the conductor status should say it is watching 2
    And the conductor status should say 1 piece of work
    When I open the watched terminals
    Then the watched split should be drawn under the terminal it is a split of
    When I create a terminal
    And I ask the conductor to watch the terminal I just created
    Then the conductor status should say it is watching 3
    And the conductor status should say 2 pieces of work
    And the conductor tab should show a badge of 2
    And the conductor tab badge should not be the needs-you one
    When I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    And the conductor tab badge should be the needs-you one
    And the conductor tab should show a badge of 2
    And there should be no page errors

  Scenario: Alt+Enter steers a message into the turn that is running
    # Enter would queue it behind the turn; Alt+Enter puts it INTO the turn.
    # The fixture says what it heard mid-turn, and the row is never queued.
    When I enter conductor mode
    And I send the conductor the prompt "work until steered"
    Then the conductor should offer to steer
    When I steer the conductor with "not that file"
    Then the conductor transcript should show a row of kind "agent" saying "heard: not that file"
    And the conductor transcript should mark no user row "queued"
    And there should be no page errors

  Scenario: The status line says what the Conductor is doing, in one place
    When I enter conductor mode
    And I send the conductor the prompt "work for a while"
    Then the conductor status should read "working"
    And the conductor status should count how long it has been working
    And the conductor header should carry no state chip
    And there should be no page errors

  Scenario: Leaving the conversation and coming back finds it exactly as it was
    # THE PANE IS MOUNTED ONCE AND RETAINED. A tab switch changes what is on
    # screen, not what exists — so the watched panel is still open, the Look is
    # still open with the terminal's own lines in it, and the half-typed
    # message is still in the box. The marker is a property put on the DOM NODE
    # by hand: a pane rebuilt from the same markup comes back without it, so
    # this is element identity and not a look-alike.
    #
    # The Look's text is COMPUTED by the shell, so the command line's echo
    # cannot satisfy it: only the terminal's own screen can.
    When I create a terminal
    And I run "echo kolu-watch-$((6*7))"
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say it is watching 1
    When I open the watched terminals
    And I look at the watched terminal
    Then the watched terminal's look should show "kolu-watch-42"
    When I type "half a thought" into the conductor without sending
    And I mark the conductor pane
    And I press Escape
    Then the conductor pane should not be visible
    When I enter conductor mode
    Then the conductor pane should be the one I marked
    And the watched panel should list the watched terminal
    And the watched terminal's look should show "kolu-watch-42"
    And the conductor composer should still hold "half a thought"
    And there should be no page errors

  @mobile
  Scenario: The status line and the watched panel fit a phone
    # The phone's terminal is a plain shell: watching one is allowed (it stays
    # listed, and never rings), which is all this layout check needs.
    When I ask the conductor to watch the first terminal
    Then the conductor status should say it is watching 1
    When I open the watched terminals
    Then the watched panel should list the watched terminal
    And nothing on screen should reach past the window's right edge
