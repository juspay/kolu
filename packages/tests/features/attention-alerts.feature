Feature: Attention Alerts
  Workspace switcher glow and audio when a background terminal's Claude finishes.

  Background:
    Given the terminal is ready

  Scenario: Visiting notified terminal clears the glow
    When I create a terminal
    And I simulate an attention alert
    Then a workspace switcher branch should be notified
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: An agent awaiting you badges the PWA dock icon
    # W5 cross-host attention: the app badge is now the count of agents AWAITING
    # you across every bound host (padi's `urgency` projection), not the old
    # active-host attention marks. A simulated attention alert (glow /
    # notification) no longer badges — a REAL `awaiting_user` agent does, which is
    # the done-criterion. Driven through the real agent-state pipeline (padi's
    # urgency fold → the client's cross-host watcher), so the badge assertion
    # polls for the wire round-trip.
    When I stub the Badging API
    And a Claude Code session is mocked with state "awaiting_user"
    And I create a terminal
    Then the tile chrome should show an agent indicator with state "awaiting_user"
    And the app badge should show 1
    And there should be no page errors

  Scenario: Alerts respect the settings toggle
    When I create a terminal
    And I click the settings button
    And I click the attention alerts toggle
    And I press Escape
    And I simulate an attention alert
    Then no workspace switcher branch should be notified
    And there should be no page errors
