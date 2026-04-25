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

  Scenario: Toggle shuffle theme setting
    When I click the settings button
    Then the settings popover should be visible
    When I click the shuffle theme toggle
    Then the shuffle theme toggle state should change
    And there should be no page errors

  Scenario: Toggle match-OS-appearance setting
    When I click the settings button
    Then the settings popover should be visible
    Then the match-OS-appearance toggle state should change
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
