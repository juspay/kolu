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
    Then the color scheme should be "light"
    And there should be no page errors

  Scenario: Scroll lock toggle persists across reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the scroll lock toggle
    Then the scroll lock toggle should be disabled
    When I reload the page and wait for ready
    When I click the settings button
    Then the settings popover should be visible
    Then the scroll lock toggle should be disabled
    And there should be no page errors

  Scenario: Activity alerts toggle persists across reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the activity alerts toggle
    Then the activity alerts toggle should be disabled
    When I reload the page and wait for ready
    When I click the settings button
    Then the settings popover should be visible
    Then the activity alerts toggle should be disabled
    And there should be no page errors
