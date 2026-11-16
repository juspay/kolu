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
    # The terminal is made where it can be SEEN: a terminal made from behind
    # the conversation is never shown, so an agent launched there would be
    # typed at blind. The watch step steps back in.
    When I leave the conductor for the host tab
    And I create a terminal
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When the Claude Code session state changes to "awaiting_user"
    Then the conductor transcript should show a wake about the watched terminal
    And the wake should be one line from kolu
    When I open the wake
    Then the wake should give the whole account of the watched terminal
    And the conductor transcript should show a row of kind "agent" saying "woke"
    And there should be no page errors

  Scenario: A wake-up names its piece of work, and the name takes you to it
    # WHICH WORK RANG is the first thing a person needs from a wake: the line
    # carries that work as a chip, read off the terminal the wake is about,
    # and pressing the chip opens the work's card where it can be seen.
    When I leave the conductor for the host tab
    And I create a terminal
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When the Claude Code session state changes to "awaiting_user"
    Then the conductor transcript should show a wake about the watched terminal
    And the wake should name the watched work with a chip
    When I press the wake's work chip
    Then the watched work's card should be open
    And there should be no page errors

  Scenario: A session the Conductor finds idle rings once as ready
    # The INFERRED reading of ready, and the only case left for it: a session
    # kolu did not watch come up — an adopted or resumed one, written here
    # against a terminal's own shell pid — whose agent is idle and which this
    # conversation has never spoken to. It rings READY rather than "stopped",
    # because an agent nobody briefed has not stopped doing anything.
    #
    # The DIRECT reading — an agent padi watched come up, whose own state is
    # `fresh` — is the scenario at the end of this file.
    When I leave the conductor for the host tab
    And I create a terminal
    And I note the terminal's shell pid
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When a Claude Code session is mocked with state "waiting" on the noted terminal
    Then the conductor transcript should show a "ready" wake about the watched terminal
    And the conductor transcript should show a row of kind "agent" saying "woke"
    And there should be no page errors

  Scenario: A wake that rings while the Conductor works waits for the turn to end
    # HELD, never injected: the count on the status line says it is waiting,
    # nothing lands in the transcript while the turn runs, and it arrives on
    # its own the moment the turn ends.
    When I leave the conductor for the host tab
    And I create a terminal
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When I send the conductor the prompt "work for a while"
    Then the conductor status should read "working"
    When the Claude Code session state changes to "awaiting_user"
    Then the conductor status should say 1 waiting
    And the conductor transcript should show no wake
    And the conductor transcript should show a wake about the watched terminal
    And the conductor status should say nothing is waiting
    And there should be no page errors

  Scenario: A work's terminals are listed, looked at, and pressed to go there
    # The marker is COMPUTED by the shell so the command line's echo cannot
    # satisfy the Look: only the terminal's own screen can.
    #
    # ... and the member's NAME is the way to the terminal itself: the same
    # journey the create card's "open tile" makes — leave the conversation,
    # land on that terminal's tile — because it is the same code path.
    When I leave the conductor for the host tab
    And I create a terminal
    And I run "echo kolu-watch-$((6*7))"
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When I open the work card
    Then the work column should list the terminal as a member
    When I look at the member terminal
    Then the member terminal's look should show "kolu-watch-42"
    When I press the member terminal's name
    Then the conductor pane should not be visible
    And the member terminal should be the focused tile
    And there should be no page errors

  Scenario: The tab's badge counts what is waiting on you, and is absent when nothing is
    # ONE BADGE on the Conductor's tab, like an unread count — and the number
    # is how many things are WAITING ON YOU, which is not how much is in
    # flight. Work the agents are getting on with is not a demand on your
    # attention: two pieces of work in progress and nothing asked show no
    # badge at all. A question lights it, in the violet that means "you".
    #
    # The status line keeps the other number, because "how much is in
    # progress" is still worth reading — it is simply not what a badge is for.
    When I create a terminal
    And I ask the conductor to watch the terminal I just created
    Then the conductor status should say 1 piece of work
    When I create a terminal
    And I ask the conductor to watch the terminal I just created
    Then the conductor status should say 2 pieces of work
    And the conductor status should say nothing is waiting on you
    And the conductor tab should show no badge
    When I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    And the conductor status should say 1 waiting on you
    And the conductor tab should show a badge of 1
    And the conductor tab badge should be the needs-you one
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
    # screen, not what exists — so the work card is still open, the Look is
    # still open with the terminal's own lines in it, and the half-typed
    # message is still in the box. The marker is a property put on the DOM NODE
    # by hand: a pane rebuilt from the same markup comes back without it, so
    # this is element identity and not a look-alike.
    #
    # The Look's text is COMPUTED by the shell, so the command line's echo
    # cannot satisfy it: only the terminal's own screen can.
    When I leave the conductor for the host tab
    And I create a terminal
    And I run "echo kolu-watch-$((6*7))"
    And a Claude Code session is mocked with state "thinking"
    And I ask the conductor to watch the terminal
    Then the conductor status should say 1 piece of work
    When I open the work card
    And I look at the member terminal
    Then the member terminal's look should show "kolu-watch-42"
    When I type "half a thought" into the conductor without sending
    And I mark the conductor pane
    And I press Escape
    Then the conductor pane should not be visible
    When I enter conductor mode
    Then the conductor pane should be the one I marked
    And the work column should list the terminal as a member
    And the member terminal's look should show "kolu-watch-42"
    And the conductor composer should still hold "half a thought"
    And there should be no page errors

  @omp-mock
  Scenario: An agent the Conductor starts rings ready once, and can be spoken to
    # THE WHOLE LOOP, with nothing mocked between the conversation and the
    # terminal: the Conductor opens a piece of work, calls `lifecycle_create`
    # with that work, a role and a command to run, that command is a coding
    # agent, and the agent comes up with no transcript of any kind. Its READY
    # here is the DIRECT reading — padi watched the process arrive and its own
    # state is `fresh` — not the inference the scenario near the top of this
    # file makes about a session it merely found.
    #
    # It rings ONCE: coming up is one piece of news, not a condition to be
    # reminded about.
    #
    # Then the Conductor SPEAKS to it, through the same fleet face, and the
    # answer says the words were submitted rather than refused — a `fresh` agent
    # is exactly the agent a conductor briefs. The proof they arrived is on the
    # terminal's own screen: the stand-in echoes what it hears behind a marker it
    # assembles at runtime, so nothing kolu typed can spell it.
    When I ask the conductor to run an agent in a new terminal
    Then the conductor status should say 1 piece of work
    And the conductor transcript should show a "ready" wake about the watched terminal
    And the conductor transcript should show exactly one "ready" wake about the watched terminal
    And the conductor transcript should show a row of kind "agent" saying "woke"
    When I ask the conductor to tell the agent "take a look at the parser"
    Then the conductor transcript should show a row of kind "agent" saying "submitted"
    When I open the work card
    And I look at the member terminal
    Then the member terminal's look should show "omp-stand-in-heard take a look at the parser"
    And there should be no page errors
