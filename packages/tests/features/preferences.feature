Feature: Server-side preferences
  Preferences persist on the server and survive page reloads.

  Background:
    Given the terminal is ready

  Scenario: Color scheme persists across reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the "light" color scheme button
    Then the color scheme should be "light"
    When I reload the page and wait for ready
    When I click the settings button
    Then the color scheme should be "light"
    And there should be no page errors

  Scenario: Terminal renderer preference swaps the active tile and persists
    Then the terminal renderer should be "webgl"
    When I click the settings button
    Then the settings popover should be visible
    When I click the "dom" renderer button
    Then the terminal renderer should be "dom"
    When I reload the page and wait for ready
    Then the terminal renderer should be "dom"
    And there should be no page errors
