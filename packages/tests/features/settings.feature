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

  Scenario: Switch theme mode to variegated
    When I click the settings button
    Then the settings popover should be visible
    When I click the "variegated" theme mode button
    Then the theme mode should be "variegated"
    When I click the "random" theme mode button
    Then the theme mode should be "random"
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
