Feature: Printed URL joins the scanner (PRT4)
  Agents print `http://localhost:5173/` constantly, and "localhost" in the
  viewer's browser is the wrong machine. Clicking a loopback URL raises a card
  at the cursor that answers through the door machinery — forward & open, path
  preserved. The printed URL is an entry point, never a fact: every affordance
  is earned by a click-time join against the scanner's observations.

  Background:
    Given the terminal is ready

  Scenario: Clicking a printed loopback URL opens the page through the door
    # Headline: a real PTY prints a real URL; the click lands the page's own
    # body through the door, path preserved.
    When I start a path-aware listener on port 8130 bound to loopback only
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show port 8130 as needing a forward
    When I print the URL "http://localhost:8130/hello/path"
    And I click the terminal web link "http://localhost:8130/hello/path"
    Then the printed-url card should be open with join state "joined"
    When I click forward-and-open on the printed-url card
    Then the forwarded tab should load the listener path "/hello/path"
    And there should be no page errors

  Scenario: An open card upgrades live when the listener appears
    # The join is a live derivation, never frozen at click. Print first, open
    # the card while nothing is listening, then bind — the card upgrades.
    When I print the URL "http://localhost:8131/soon"
    And I click the terminal web link "http://localhost:8131/soon"
    Then the printed-url card should be open with join state "unbacked"
    When I start a path-aware listener on port 8131 bound to loopback only
    Then the printed-url card should upgrade to join state "joined"
    And there should be no page errors

  Scenario: Cmd-click bypasses the card and opens the raw URL
    # A live listener so the raw open is a real navigation, not chrome-error
    # from a refused connection (nothing was bound on the prior cut).
    When I start a path-aware listener on port 8132 bound to loopback only
    And I print the URL "http://localhost:8132/"
    And I cmd-click the terminal web link "http://localhost:8132/"
    Then the printed-url card should not be open
    And a raw popup should have opened for "http://localhost:8132/"
    And there should be no page errors
