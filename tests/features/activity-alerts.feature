Feature: Activity Alerts
  Sidebar glow and audio when a background terminal's Claude finishes.

  Background:
    Given the terminal is ready

  Scenario: Simulated alert shows sidebar glow on background terminal
    When I create a terminal
    And I simulate an activity alert
    Then a sidebar entry should be notified
    And there should be no page errors

  Scenario: Visiting notified terminal clears the glow
    When I create a terminal
    And I simulate an activity alert
    Then a sidebar entry should be notified
    When I click the notified sidebar entry
    Then no sidebar entry should be notified
    And there should be no page errors

  Scenario: Simulated alert badges the PWA dock icon
    When I create a terminal
    And I stub the Badging API
    And I simulate an activity alert
    Then the app badge should show 1
    When I click the notified sidebar entry
    Then the app badge should be cleared
    And there should be no page errors

  Scenario: Alerts respect the settings toggle
    When I create a terminal
    And I click the settings button
    And I click the activity alerts toggle
    And I press Escape
    And I simulate an activity alert
    Then no sidebar entry should be notified
    And there should be no page errors
