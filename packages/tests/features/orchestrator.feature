Feature: The Orchestrator
  ONE ACP conversation for the whole fleet — hosted by kolu-server, not by any
  one host's padi — reached from its own `◆ Orchestrator` entry in the chrome
  tab row, beside the host tabs and deliberately not one of them. Every
  scenario runs against a scripted ACP adapter the harness points
  `KOLU_ACP_AGENT` at, so the frames the panel draws are frames a real agent
  could have sent — not a stubbed store.

  Background:
    Given the terminal is ready
    # kolu-server holds ONE conversation for the life of the server, and the
    # suite's worker shares one server across every scenario in this file. So a
    # scenario that inherited the last one's conversation would inherit its
    # turns too — a question still waiting on an answer leaves every later
    # prompt `queued` behind it, and the failure surfaces three scenarios away
    # from its cause. A fresh session is the isolation: the old one is left,
    # the standing prompt is taught again, and nothing is in flight.
    #
    # THE GESTURE, as the product now spells it: the `⋯` menu beside the
    # composer, `New session`, and then a second press to confirm — a wipe is
    # not something one stray click may do. And it IS a wipe: the transcript
    # goes empty rather than gaining a `— new session —` divider under the old
    # rows, so this arrangement is proved by a transcript with no rows in it
    # and a conversation back at `idle`.
    And the orchestrator is on a fresh conversation

  Scenario: Entering the orchestrator gives the chat the whole workspace
    # The view is CHAT ONLY: no dock, no fleet list, no peek pane, no canvas.
    # So the proof is that the pane covers everything below the chrome bar —
    # a pane sharing the width with a sidebar or a peek column would fail this
    # without anybody having to name the column that came back.
    #
    # The Background left us IN the conversation, so it is left FIRST — the
    # chord then proves it enters rather than that it was already there. `Esc`
    # is the leave here and the chord is the leave below, because both are
    # offered and they must agree.
    When I press Escape
    Then the orchestrator pane should not be visible
    When I create a terminal
    And I press the orchestrator shortcut
    Then the orchestrator pane should be visible
    And the orchestrator pane should fill the workspace
    And the orchestrator tab should be active
    When I press the orchestrator shortcut
    Then the orchestrator pane should not be visible
    And there should be no page errors

  Scenario: The orchestrator entry is a destination, not a host
    # It shares the tab row with the hosts and is NOT one of them: no host key,
    # no entry in the host map, nothing in the host switcher. The round trip is
    # the other half of the same claim — `⌘⇧O` back lands on the host tab you
    # came from, which it can only do because selecting the conversation never
    # touched which host is active.
    When I press Escape
    Then the orchestrator pane should not be visible
    And I note the active host tab
    When I create a terminal
    And I press the orchestrator shortcut
    Then the orchestrator pane should be visible
    And the orchestrator tab should be active
    And no host tab should be the orchestrator
    When I press the orchestrator shortcut
    Then the orchestrator pane should not be visible
    And the active host tab should be the one I noted
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
    # is a word on the roster strip nobody is reading. kolu-server proves the
    # fleet MCP endpoint before it hands the URL over; this is the other end of
    # that — the AGENT'S own report, which only arrives at the start of a turn,
    # so this has to follow one. Before anything is said the row reads `handed`,
    # which is the honest "handed over, nobody has reported either way".
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "say hello"
    Then the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And the orchestrator roster should show "kolu" as connected
    And there should be no page errors

  Scenario: The agent reads this fleet's terminals through kolu's own MCP face
    # THE HANDS, END TO END. The scenario above proves the agent was HANDED a
    # kolu server; this one proves the server answers. The fixture agent opens
    # a real MCP session on the loopback endpoint kolu-server put on its
    # `session/new` and reads two resources — the roster and the fleet's
    # terminals — then says what it read. Every seam of the fleet face is on
    # that path: the MCP door, the expose map, the `FleetHosts` port, padi's
    # client face, and the served host map its calls are dialled into. A face
    # built over a surface the server does not serve answers here with
    # `no handler bound at "surface/padi/terminals/keys"` instead of a
    # terminal, which is exactly how this shipped broken once.
    #
    # SINGLE-HOST LANE, recorded rather than faked. This worker holds one padi
    # (`local`), the same limit `ports.feature` states for its remote leg. So
    # what IS proved here is that the fleet face reaches a REAL padi through
    # the REAL mounting and answers a terminal that really exists on the
    # machine the suite just created it on. What is NOT proved is the
    # multi-host fold — that a second host's rows and terminals merge in roster
    # order and that a per-host refusal names its host. Those need a second
    # padi: run this same suite with `KOLU_E2E_PADI_HOST=<disposable host>`
    # (see `packages/tests/support/hooks.ts` — it is DESTRUCTIVE and demands
    # `KOLU_E2E_SSH_DESTRUCTIVE_ACK=1`), where the roster line below carries
    # that host too. The merge itself is pinned without a machine in
    # `packages/kolu-mcp/src/fleet/fleet.test.ts`.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "list the fleet"
    Then the orchestrator transcript should show a row of kind "agent" saying "fleet hosts: local=connected"
    And the orchestrator transcript should show a row of kind "agent" saying "fleet terminals: local/"
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

  Scenario: A tool card names the host it acted on, and opens that tile
    # One conversation drives terminals on every machine, so a card naming only
    # `fix-parser` would not say where the agent typed — and "open tile" goes to
    # a different tab depending on the answer. The fixture answers
    # `lifecycle_create` in the fleet grammar (a `host` on the call, a `host/id`
    # ref in the answer), which is exactly what the card reads.
    #
    # SINGLE-HOST LIMIT, recorded rather than faked: this worker has one padi
    # (`local`) — the same limit `ports.feature` states for its remote leg and
    # `terminal-switcher.feature` for its cross-host paths. So the host named
    # here is the local one and the tab switch is to the tab already selected;
    # what IS proved end to end is that the card carries a host at all, that it
    # is the host the agent named, and that pressing it leaves the conversation
    # and lands focus on that terminal's tile. The second-host leg lives in
    # `packages/client/src/orchestrator/OrchestratorToolCard.test.tsx`, where a
    # remote ref can be handed in without pretending a machine exists.
    When I create a terminal
    And I enter orchestrator mode
    And I ask the orchestrator to adopt the terminal
    Then the orchestrator transcript should show a "create" tool card
    And that tool card should name the host "local"
    When I open that tool card's tile
    Then the orchestrator pane should not be visible
    And the adopted terminal should be the focused tile
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
    And the orchestrator tab should show a badge of 1
    When I answer the orchestrator's question with "30"
    Then the orchestrator should not be asking
    And the orchestrator tab should show no badge
    And there should be no page errors

  Scenario: An unanswered question is a needs-you source from the tab row
    # Leave the conversation and its pane is gone — the chrome-bar entry is the
    # whole of its presence on a host tab, so the badge has to count the asks
    # without the pane mounted to count them from.
    When I create a terminal
    And I enter orchestrator mode
    And I send the orchestrator the prompt "ask me something"
    Then the orchestrator should be asking
    When I press Escape
    Then the orchestrator pane should not be visible
    And the orchestrator tab should show a badge of 1
    And there should be no page errors

  Scenario: A pasted image rides the message as an attachment
    # The whole attachment path, end to end: the browser reads the clipboard's
    # PNG, puts its bytes on kolu-server in frame-bounded chunks through
    # `orchestrator.attach` (the chip says `uploading…` until they land under
    # the server's state dir), and the prompt then NAMES the file rather than
    # carrying it. The user row is where that join is visible — a row with no
    # attachment means the bytes and the message never met, which is the one
    # failure a chip that looks ready cannot tell you about.
    When I create a terminal
    And I enter orchestrator mode
    And I paste an image into the orchestrator composer
    Then the orchestrator composer should show a settled attachment chip
    When I send the orchestrator the prompt "look at this"
    Then the orchestrator transcript should show a user row carrying an image attachment
    And the orchestrator transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: The transcript comes back after a reload
    # kolu-server persists the rows and serves them BEFORE the agent is up, so a
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
