Feature: The Conductor
  ONE ACP conversation for the whole fleet — hosted by kolu-server, not by any
  one host's padi — reached from its own `◆ Conductor` entry in the chrome
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
    And the conductor is on a fresh conversation

  Scenario: Entering the conductor gives the chat the whole workspace
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
    Then the conductor pane should not be visible
    When I create a terminal
    And I press the conductor shortcut
    Then the conductor pane should be visible
    And the conductor pane should fill the workspace
    And the conductor tab should be active
    When I press the conductor shortcut
    Then the conductor pane should not be visible
    And there should be no page errors

  Scenario: The conductor entry is a destination, not a host
    # It shares the tab row with the hosts and is NOT one of them: no host key,
    # no entry in the host map, nothing in the host switcher. The round trip is
    # the other half of the same claim — `⌘⇧O` back lands on the host tab you
    # came from, which it can only do because selecting the conversation never
    # touched which host is active.
    When I press Escape
    Then the conductor pane should not be visible
    And I note the active host tab
    When I create a terminal
    And I press the conductor shortcut
    Then the conductor pane should be visible
    And the conductor tab should be active
    And no host tab should be the conductor
    When I press the conductor shortcut
    Then the conductor pane should not be visible
    And the active host tab should be the one I noted
    And there should be no page errors

  Scenario: A prompt round trip draws the agent's answer
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "user" saying "say hello"
    And the conductor transcript should show a row of kind "agent" saying "hello back"
    And the conductor state chip should read "idle"
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
    And I enter conductor mode
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And the conductor roster should show "kolu" as connected
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
    And I enter conductor mode
    And I send the conductor the prompt "list the fleet"
    Then the conductor transcript should show a row of kind "agent" saying "fleet hosts: local=connected"
    And the conductor transcript should show a row of kind "agent" saying "fleet terminals: local/"
    And there should be no page errors

  Scenario: A kolu tool call is drawn as a card that knows what it means
    # The whole point of the kolu-aware cards: a call to one of OUR tools is
    # read structurally, so the row can name the terminal and offer to open it
    # — rather than printing JSON the way an unrecognised tool's card does.
    When I create a terminal
    And I enter conductor mode
    And I ask the conductor to adopt the terminal
    Then the conductor transcript should show a "create" tool card
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
    # `packages/client/src/conductor/ConductorToolCard.test.tsx`, where a
    # remote ref can be handed in without pretending a machine exists.
    When I create a terminal
    And I enter conductor mode
    And I ask the conductor to adopt the terminal
    Then the conductor transcript should show a "create" tool card
    And that tool card should name the host "local"
    When I open that tool card's tile
    Then the conductor pane should not be visible
    And the adopted terminal should be the focused tile
    And there should be no page errors

  Scenario: An unrecognised tool gets the generic card, never a kolu one
    # The direction this is safe to fail in. A tool the harness cannot
    # positively name as one of the servers WE handed over must not acquire a
    # kolu reading by resembling one.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "use its own tool"
    Then the conductor transcript should show a "generic" tool card
    And there should be no page errors

  Scenario: A minified 5 KB payload stays inside its card
    # THE SHAPE THAT BROKE THE LAYOUT: `ListMcpResourcesTool` answers with its
    # JSON as one minified line, and such a line holds no break opportunity at
    # all where a value is a long hash — so nothing in it is a place a browser
    # may wrap. A card that neither wraps nor contains it is as wide as the
    # line, and because every box between it and the document is a flex or
    # grid child whose default `min-width: auto` refuses to shrink below its
    # content, the TRANSCRIPT, the PANE and then the DOCUMENT all become that
    # wide. What the reader sees is the chrome bar's right cluster pushed off
    # the window and a stray rule down the middle of the screen — symptoms
    # three layers away from the card that caused them.
    #
    # THE PAYLOAD IS MEASURED OPENED, because a `<details>` that is shut has no
    # layout: a closed-card measurement reads `display: none` and would pass
    # against any markup at all. For the same reason this assertion lives HERE
    # and not in the client's unit lane — happy-dom has no layout engine, so
    # every width it reports is zero and `scrollWidth <= clientWidth` is true
    # there however broken the card is.
    #
    # THE THREE THINGS ASSERTED ARE DIFFERENT. A block with `overflow-x: auto`
    # CONTAINS a 25 000 px line and is unreadable; a block with
    # `overflow: hidden` CUTS it and loses what the agent read. Both satisfy
    # containment, so readability (the line wrapped) is its own assertion.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "list the resources"
    Then the conductor transcript should show a "generic" tool card
    When I open that tool card's folded payload
    Then that tool card should keep the payload inside it
    And that tool card's payload should be readable without scrolling sideways
    And the page should be no wider than the window
    # AND AT NARROWING WINDOWS, down to the width below which this chrome is
    # swapped for the phone layout. Each step measures two things: that nothing
    # in the pane has pushed the document past the window, and that the chrome
    # bar's own row still fits — the row whose right cluster went off screen in
    # the report this scenario comes from.
    #
    # WHAT THIS LANE CANNOT PROVE: the worker holds ONE padi (`local`), the
    # same limit `ports.feature` states for its remote leg, so the host strip
    # here has a single tab and never folds. The five-host fold — tabs going
    # into `⋯ +N` before anything collides — is pinned without a machine in
    # `packages/client/src/host/hostOverflow.test.ts`, against the same pure
    # function the strip calls with real measured widths. What IS proved here
    # is the arithmetic's INPUT: the strip's measured width is the row's true
    # leftover after the identity rail, the `◆ Conductor beta` pill and the
    # control cluster have taken theirs, which is the premise that fold rests
    # on and the one a second entry in the row could silently break.
    When I resize the viewport to 1024x768
    Then that tool card should keep the payload inside it
    And the page should be no wider than the window
    And the chrome bar should fit the window
    When I resize the viewport to 820x768
    Then the page should be no wider than the window
    And the chrome bar should fit the window
    When I resize the viewport to 700x768
    Then the page should be no wider than the window
    And the chrome bar should fit the window
    When I resize the viewport to 660x768
    Then the page should be no wider than the window
    And the chrome bar should fit the window
    And there should be no page errors

  Scenario: A question the agent asks is answered from the transcript
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    And the conductor tab should show a badge of 1
    When I answer the conductor's question with "30"
    Then the conductor should not be asking
    And the conductor tab should show no badge
    And there should be no page errors

  Scenario: An unanswered question is a needs-you source from the tab row
    # Leave the conversation and its pane is gone — the chrome-bar entry is the
    # whole of its presence on a host tab, so the badge has to count the asks
    # without the pane mounted to count them from.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    When I press Escape
    Then the conductor pane should not be visible
    And the conductor tab should show a badge of 1
    And there should be no page errors

  Scenario: A pasted image rides the message as an attachment
    # The whole attachment path, end to end: the browser reads the clipboard's
    # PNG, puts its bytes on kolu-server in frame-bounded chunks through
    # `conductor.attach` (the chip says `uploading…` until they land under
    # the server's state dir), and the prompt then NAMES the file rather than
    # carrying it. The user row is where that join is visible — a row with no
    # attachment means the bytes and the message never met, which is the one
    # failure a chip that looks ready cannot tell you about.
    When I create a terminal
    And I enter conductor mode
    And I paste an image into the conductor composer
    Then the conductor composer should show a settled attachment chip
    When I send the conductor the prompt "look at this"
    Then the conductor transcript should show a user row carrying an image attachment
    And the conductor transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: The transcript comes back after a reload
    # kolu-server persists the rows and serves them BEFORE the agent is up, so a
    # reload shows the conversation you were in rather than an empty pane that
    # fills in a second later.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    When I reload the page
    And I enter conductor mode
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: A message sent while the agent is working is marked queued
    # Nothing is held on this side — the message really is at the agent, next
    # in line — so the mark is a fact about the agent's queue, and it comes off
    # by itself when the turn in front of it ends.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "work slowly"
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should mark a user row "queued"
    And the conductor transcript should show a row of kind "agent" saying "hello back"
    And the conductor transcript should mark no user row "queued"
    And there should be no page errors

  Scenario: An agent that refuses the turn leaves the conversation ready
    # A turn the agent answers with an error is a turn that ENDED, not an agent
    # that has gone: the next message goes to the same agent.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "refuse this"
    Then the conductor transcript should mark a user row "refused"
    And the conductor state chip should read "idle"
    When I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: The transcript follows the conversation, and lets go when you read
    # THE RULE IS THE SCROLLBACK'S, and a chat obeys it or is unusable. The
    # fixture streams thirty chunks, a paragraph at a time — several pane-fuls
    # — and the view has to be at the end when they stop, which it can only be
    # by having followed every one of them. A rule that asks the container
    # "are you at the end?" AFTER drawing a chunk fails here on the first
    # paragraph taller than its slack: the column grew under a view that did
    # not move, so the honest measurement says "scrolled up" about content
    # that landed a millisecond ago, and the answer runs off the bottom.
    #
    # THE OTHER HALF IS THE READER'S. Once somebody scrolls up to read
    # something, nothing may drag them back — so the view stays exactly where
    # the wheel left it, and the way back is OFFERED (the terminal's own pill,
    # the same affordance in both places) rather than taken for them.
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom
    When I scroll the conductor transcript up
    Then the conductor transcript should stay where the reader left it
    And the conductor should offer the way back to the bottom
    When I take the way back to the bottom
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom
    And there should be no page errors
