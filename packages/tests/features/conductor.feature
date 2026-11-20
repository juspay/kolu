Feature: The Conductor
  ONE ACP conversation for the whole fleet — hosted by kolu-server, not by any
  one host's padi — reached from its own `◆ Conductor` tab, first in the chrome
  bar's tab row, drawn like the host tabs and deliberately not one of them. Every
  scenario runs against a scripted ACP adapter the harness points
  `KOLU_ACP_AGENT` at, so the frames the panel draws are frames a real agent
  could have sent — not a stubbed store.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: Entering the conductor gives the chat the whole workspace
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

  Scenario: The Conductor is the first tab, and the only one lit while you are in it
    When I press Escape
    Then the conductor pane should not be visible
    When I create a terminal
    Then the conductor tab should come first in the tab row
    And exactly one host tab should look current
    And the host view controls should be shown
    When I press the conductor shortcut
    Then the conductor tab should be active
    And no host tab should look current
    And the host view controls should not be shown
    When I press the conductor shortcut
    Then the conductor pane should not be visible
    And exactly one host tab should look current
    And the host view controls should be shown
    And there should be no page errors

  Scenario: A prompt round trip draws the agent's answer
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "user" saying "say hello"
    And the conductor transcript should show a row of kind "agent" saying "hello back"
    And the conductor status should read "idle"
    And there should be no page errors

  Scenario: The agent really has hold of kolu's own MCP server
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And the conductor roster should show "kolu" as connected
    And there should be no page errors

  Scenario: The agent reads this fleet's terminals through kolu's own MCP face
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "list the fleet"
    Then the conductor transcript should show a row of kind "agent" saying "fleet hosts: local=connected"
    And the conductor transcript should show a row of kind "agent" saying "fleet terminals: local/"
    And there should be no page errors

  Scenario: A kolu tool call is drawn as a card that knows what it means
    When I create a terminal
    And I enter conductor mode
    And I ask the conductor to adopt the terminal
    Then the conductor transcript should show a "create" tool card
    And that tool card should name the terminal "fix-parser"
    And that tool card should offer to open its tile
    And there should be no page errors

  Scenario: A tool card names the host it acted on, and opens that tile
    When I create a terminal
    And I enter conductor mode
    And I ask the conductor to adopt the terminal
    Then the conductor transcript should show a "create" tool card
    And that tool card should name the host "local"
    When I open that tool card's tile
    Then the conductor pane should not be visible
    And the adopted terminal should be the focused tile
    And there should be no page errors

  Scenario: Look reads the agent's screen from inside the chat
    When I leave the conductor for the host tab
    And I create a terminal
    And I run "echo kolu-look-$((6*7))"
    And I ask the conductor to adopt the terminal I am in
    Then the conductor transcript should show a "create" tool card
    And that tool card should say how its terminal is doing
    When I look at that tool card's terminal
    Then the look should show "kolu-look-42"
    When I press Escape
    And I close the active terminal via command palette
    And I enter conductor mode
    Then that tool card should say its terminal is gone
    And there should be no page errors

  Scenario: The calls a turn makes before the Conductor speaks fold into Details
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "work quietly"
    Then the conductor transcript should show a row of kind "agent" saying "Found what I needed."
    And the conductor transcript should fold 2 tool calls into one closed Details
    And the failed tool call should stay in the flow
    When I open the Details fold
    Then the Details fold should show its 2 tool calls
    And there should be no page errors

  Scenario: The calls fold while the Conductor is still working
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "work in flight"
    Then the conductor transcript should fold 2 tool calls into one closed Details
    And the running tool call should stay in the flow
    When I open the Details fold
    Then the conductor status should read "working"
    And the conductor transcript should show a row of kind "agent" saying "Found what I needed."
    And the Details fold should still be open, holding 3 tool calls
    And there should be no page errors

  Scenario: A wipe forgets the calls, so the next turn's cards come back
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "work quietly"
    Then the conductor transcript should fold 2 tool calls into one closed Details
    When I start a new conductor session
    Then the conductor transcript should be empty
    When I send the conductor the prompt "work quietly"
    Then the conductor transcript should show a row of kind "agent" saying "Found what I needed."
    And the conductor transcript should fold 2 tool calls into one closed Details
    And the failed tool call should stay in the flow
    And there should be no page errors

  Scenario: An unrecognised tool gets the generic card, never a kolu one
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "use its own tool"
    Then the conductor transcript should show a "generic" tool card
    And there should be no page errors

  Scenario: A minified 5 KB payload stays inside its card
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "list the resources"
    Then the conductor transcript should show a "generic" tool card
    When I open that tool card's folded payload
    Then that tool card should keep the payload inside it
    And that tool card's payload should be readable without scrolling sideways
    And the page should be no wider than the window
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
    And the conductor tab badge should be the needs-you one
    When I answer the conductor's question with "30"
    Then the conductor should not be asking
    And the conductor tab should show no badge
    And the answered question should read "Retention — 30"
    And there should be no page errors

  Scenario: An unanswered question is a needs-you source from the tab row
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    When I press Escape
    Then the conductor pane should not be visible
    And the conductor tab should show a badge of 1
    And the conductor tab badge should be the needs-you one
    And there should be no page errors

  Scenario: A question from the Conductor rings when you are not looking at it
    When I create a terminal
    And I stub the notification sound
    And I enter conductor mode
    And I simulate the Kolu window losing focus
    And I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    And the notification sound should have played 1 time
    When I simulate the Kolu window regaining focus
    And I answer the conductor's question with "30"
    Then the conductor should not be asking
    When I send the conductor the prompt "ask me something"
    Then the conductor should be asking
    And the notification sound should have played 1 time
    When I press Escape
    Then the conductor pane should not be visible
    When I reload the page
    Then the conductor tab should show a badge of 1
    And the conductor tab badge should be the needs-you one
    And the notification sound should have played 0 times
    And there should be no page errors

  Scenario: A pasted image rides the message as an attachment
    When I create a terminal
    And I enter conductor mode
    And I paste an image into the conductor composer
    Then the conductor composer should show a settled attachment chip
    When I send the conductor the prompt "look at this"
    Then the conductor transcript should show a user row carrying an image attachment
    And the conductor transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: The transcript comes back after a reload
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    When I reload the page
    And I enter conductor mode
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: A message sent while the agent is working is marked queued
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "work slowly"
    And I send the conductor the prompt "say hello"
    Then the conductor transcript should mark a user row "queued"
    And the conductor transcript should show a row of kind "agent" saying "hello back"
    And the conductor transcript should mark no user row "queued"
    And there should be no page errors

  Scenario: An agent that refuses the turn leaves the conversation ready
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "refuse this"
    Then the conductor transcript should mark a user row "refused"
    And the conductor status should read "idle"
    When I send the conductor the prompt "say hello"
    Then the conductor transcript should show a row of kind "agent" saying "hello back"
    And there should be no page errors

  Scenario: The transcript follows the conversation, and lets go when you read
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

  Scenario: A mermaid block in an answer draws once it is complete
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "draw a diagram"
    Then the conductor transcript should show a row of kind "agent" saying "it stay put."
    And the conductor agent row saying "after the diagram" should show a painted diagram
    And the conductor agent row saying "after the diagram" should show no diagram error
    And the conductor agent row saying "after the diagram" should still fold its long list
    And the conductor transcript should be scrolled to the bottom
    And there should be no page errors
