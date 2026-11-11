Feature: The Orchestrator
  One ACP conversation per host, drawn as kolu's third view mode. Every
  scenario runs against a scripted ACP adapter the harness points
  `KOLU_ACP_AGENT` at, so the frames the panel draws are frames a real agent
  could have sent — not a stubbed store.

  Background:
    Given the terminal is ready
    # padi holds ONE conversation per host for the life of the daemon, and the
    # suite's worker shares one padi across every scenario in this file. So a
    # scenario that inherited the last one's conversation would inherit its
    # turns too — a question still waiting on an answer leaves every later
    # prompt `queued` behind it, and the failure surfaces three scenarios away
    # from its cause. A fresh session is the isolation: the old one is left,
    # the standing prompt is taught again, and nothing is in flight.
    And the orchestrator is on a fresh conversation

  Scenario: Entering orchestrator mode gives the chat the main pane
    # The mode is a THIRD axis, not an arm of the maximized posture: the dock
    # stays mounted as the sidebar and the chat takes the middle, so this
    # asserts all three regions rather than just the chat's presence.
    When I create a terminal
    # The background left us IN the mode; leave first, so the chord is proving
    # that it enters rather than that it was already there.
    And I press Escape
    Then the orchestrator pane should not be visible
    When I press the orchestrator shortcut
    Then the orchestrator pane should be visible
    And the dock should be a sidebar
    And the orchestrator mode segment should be active
    When I press Escape
    Then the orchestrator pane should not be visible
    And there should be no page errors

  Scenario: A prompt round trip draws the agent's answer
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "say hello"
    Then the orchestrator transcript should show a row of kind "user" saying "say hello"
    And the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And the orchestrator state chip should read "idle"
    And there should be no page errors

  Scenario: The agent really has hold of kolu's own MCP server
    # The one failure that looks like success: an agent whose kolu server did
    # not connect carries on running shell commands itself, and the only sign
    # is a word on the roster strip nobody is reading. padi proves the socket
    # before it hands the path over; this is the other end of that — the
    # AGENT'S own report, which only arrives at the start of a turn, so this
    # has to follow one. Before anything is said the row reads `handed`, which
    # is the honest "handed over, nobody has reported either way".
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "say hello"
    Then the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And the orchestrator roster should show "kolu" as connected
    And there should be no page errors

  Scenario: A kolu tool call is drawn as a card that knows what it means
    # The whole point of the kolu-aware cards: a call to one of OUR tools is
    # read structurally, so the row can name the terminal and offer to open it
    # — rather than printing JSON the way an unrecognised tool's card does.
    When I create a terminal
    And I enter orchestrator mode
    And I ask the orchestrator to adopt the terminal
    Then the orchestrator transcript should show a "create" tool card
    And that tool card should name the terminal "fix-parser"
    And that tool card should offer to open its tile
    And there should be no page errors

  Scenario: An unrecognised tool gets the generic card, never a kolu one
    # The direction this is safe to fail in. A tool the harness cannot
    # positively name as one of the servers WE handed over must not acquire a
    # kolu reading by resembling one.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "use its own tool"
    Then the orchestrator transcript should show a "generic" tool card
    And there should be no page errors

  Scenario: A question the agent asks is answered from the transcript
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "ask me something"
    Then the orchestrator should be asking
    And the orchestrator mode segment should show a badge of 1
    When I answer the orchestrator's question with "30"
    Then the orchestrator should not be asking
    And the orchestrator mode segment should show no badge
    And there should be no page errors

  Scenario: An unanswered question is a needs-you source in canvas mode
    # In canvas and maximized modes the orchestrator has no panel at all —
    # only its chrome-bar entry. The badge is the whole of its presence there,
    # so it has to count without the pane mounted.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "ask me something"
    Then the orchestrator should be asking
    When I press Escape
    Then the orchestrator pane should not be visible
    And the orchestrator mode segment should show a badge of 1
    And there should be no page errors

  Scenario: Clicking a fleet row swaps the peek pane
    When I create a terminal
    And I enter orchestrator mode
    And I ask the orchestrator to adopt the terminal
    Then the orchestrator transcript should show a "create" tool card
    And the orchestrator fleet should list the terminal
    When I click the first orchestrator fleet row
    Then the peek pane should show that terminal
    And there should be no page errors

  Scenario: The transcript comes back after a reload
    # padi persists the rows and serves them BEFORE the agent is up, so a
    # reload shows the conversation you were in rather than an empty pane that
    # fills in a second later.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "say hello"
    Then the orchestrator transcript should show a row of kind "agent" saying "hello back"
    When I reload the page
    And I enter orchestrator mode
    Then the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: A message sent while the agent is working is marked queued
    # Nothing is held on this side — the message really is at the agent, next
    # in line — so the mark is a fact about the agent's queue, and it comes off
    # by itself when the turn in front of it ends.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "work slowly"
    And I send the orchestrator the prompt "say hello"
    Then the orchestrator transcript should mark a user row "queued"
    And the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And the orchestrator transcript should mark no user row "queued"
    And there should be no page errors

  Scenario: An agent that refuses the turn leaves the conversation ready
    # A turn the agent answers with an error is a turn that ENDED, not an agent
    # that has gone: the next message goes to the same agent.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "refuse this"
    Then the orchestrator transcript should mark a user row "refused"
    And the orchestrator state chip should read "idle"
    When I send the orchestrator the prompt "say hello"
    Then the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors
