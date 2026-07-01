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

  Scenario: Select a new-terminal theme mode
    When I click the settings button
    Then the settings popover should be visible
    When I click the "light" new terminal theme button
    Then the "light" new terminal theme button should be selected
    When I click the "dark" new terminal theme button
    Then the "dark" new terminal theme button should be selected
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
