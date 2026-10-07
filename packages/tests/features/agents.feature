Feature: Agents come with kolu
  Settings → Agents puts agent-distro's coding agents on the PATH of NEW
  terminals, for the chosen profile. A running terminal keeps what it started
  with, and every tile says which profile it got.

  Background:
    Given the terminal is ready

  Scenario: Settings offers the Agents section with the build's profiles
    When I click the settings button
    Then the settings popover should be visible
    And the Agents section should offer the "vanilla" and "juspay" profiles
    And there should be no page errors

  Scenario: Turning Agents on changes the next terminal, not the current one
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    When I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    And the terminal's claude should be the "vanilla" fixture
    And there should be no page errors

  Scenario: Switching profile reaches the next terminal, and off removes both
    When I click the settings button
    And I turn Agents on
    And I choose the "juspay" Agents profile
    Then padi should give new terminals the "juspay" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "juspay" agents chip
    And the terminal's claude should be the "juspay" fixture
    When I click the settings button
    And I turn Agents off
    Then padi should give new terminals no agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Clicking a tile's agents pill opens Settings at the Agents rows
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I click the focused tile's agents chip
    Then the settings popover should be visible
    And the Agents section should offer the "vanilla" and "juspay" profiles
    And there should be no page errors
