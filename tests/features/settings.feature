Feature: Settings Popover
  Settings accessible via the wrench icon in the header.

  Background:
    Given the terminal is ready

  Scenario: Open and close settings popover
    When I click the settings button
    Then the settings popover should be visible
    When I press Escape
    Then the settings popover should not be visible
    And there should be no page errors

  Scenario: Toggle random theme setting
    When I click the settings button
    Then the settings popover should be visible
    When I click the random theme toggle
    Then the random theme toggle state should change
    And there should be no page errors

  Scenario: Switch UI color scheme to light
    When I click the settings button
    Then the settings popover should be visible
    When I click the "light" color scheme button
    Then the color scheme should be "light"
    And there should be no page errors

  Scenario: Switch UI color scheme back to dark
    When I click the settings button
    Then the settings popover should be visible
    When I click the "light" color scheme button
    Then the color scheme should be "light"
    When I click the "dark" color scheme button
    Then the color scheme should be "dark"
    And there should be no page errors

  Scenario: Color scheme persists across page reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the "light" color scheme button
    Then the color scheme should be "light"
    When I refresh the page
    Then the color scheme should be "light"
    And there should be no page errors
