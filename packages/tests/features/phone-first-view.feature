Feature: A phone opens on the Conductor

  @mobile @fresh-open
  Scenario: A fresh open on a phone lands on the Conductor
    Given I open kolu for the first time in this tab
    Then the conductor pane should be visible
    And there should be no page errors

  @mobile @fresh-open
  Scenario: A reload stays where you were
    Given I open kolu for the first time in this tab
    Then the conductor pane should be visible
    When I tap the mobile pull handle
    And I tap the local host chip
    Then the conductor pane should not be visible
    When I reload the tab
    Then the conductor pane should not be visible
    And there should be no page errors

  @mobile @fresh-open
  Scenario: A fresh open at a link to a terminal lands on that terminal
    Given I open kolu for the first time in this tab
    When I tap the mobile pull handle
    And I tap the local host chip
    And I create a terminal
    And I open the deep link "#/t/local/{id1}" as a fresh open
    Then the conductor pane should not be visible
    And the terminal on screen should be "{id1}"
    And there should be no page errors

  @compact @fresh-open
  Scenario: A tablet's fresh open lands on its host
    Given I open kolu for the first time in this tab
    Then the conductor pane should not be visible
    And there should be no page errors
