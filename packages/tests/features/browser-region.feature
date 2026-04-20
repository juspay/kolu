Feature: Terminal-attached browser region (Phase 0 of #633)
  Each terminal may carry a 0-or-1 right-side browser iframe. Opens via the
  tile's "Open browser" chrome button (peer to "Split terminal"), dies with
  the terminal, closes on its own × without affecting the terminal. Tile
  identity is just a URL; protocol-less input is normalized to https://
  so the iframe doesn't resolve relatively into Kolu itself.

  Background:
    Given the terminal is ready

  Scenario: Open browser button attaches a browser region to the terminal
    When I click the open-browser button on canvas tile 1
    Then a browser region should be visible on canvas tile 1
    And there should be no page errors

  Scenario: Committing a URL loads the iframe
    When I click the open-browser button on canvas tile 1
    And I enter "https://example.com" into the terminal's browser URL bar
    Then the browser region iframe src should contain "example.com"
    And there should be no page errors

  Scenario: Protocol-less URLs normalize to https:// (no Kolu recursion)
    When I click the open-browser button on canvas tile 1
    And I enter "example.com" into the terminal's browser URL bar
    Then the browser region iframe src should contain "https://example.com"
    And there should be no page errors

  Scenario: Closing the browser region leaves the terminal intact
    When I click the open-browser button on canvas tile 1
    Then a browser region should be visible on canvas tile 1
    When I click the close button on the browser region of canvas tile 1
    Then no browser region should be visible on canvas tile 1
    And there should be 1 canvas tile
    And there should be no page errors
