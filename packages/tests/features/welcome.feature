Feature: Welcome
  The bird's-eye welcome for new users — the first three moments (Choose your
  coding agents · Pin it · From another device on a fresh install) shown on
  the empty canvas, above session restore.

  Scenario: The welcome moments appear on the empty canvas
    When I open the app
    Then I see the welcome moments
