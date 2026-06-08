Feature: Welcome
  The bird's-eye welcome for new users — the three moments (Pin it · Reach it
  anywhere · Run agents) shown on the empty canvas, above session restore.

  Scenario: The welcome moments appear on the empty canvas
    When I open the app
    Then I see the welcome moments
