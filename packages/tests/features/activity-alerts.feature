Feature: Activity Alerts
  Workspace switcher glow and audio when a background terminal's Claude finishes.

  Background:
    Given the terminal is ready

  Scenario: Simulated alert shows workspace switcher glow on background terminal
    When I create a terminal
    And I simulate an activity alert
    Then a workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Visiting notified terminal clears the glow
    When I create a terminal
    And I simulate an activity alert
    Then a workspace switcher branch should be notified
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Simulated alert badges the PWA dock icon
    When I create a terminal
    And I stub the Badging API
    And I simulate an activity alert
    Then the app badge should show 1
    When I click the notified workspace switcher branch
    Then the app badge should be cleared
    And there should be no page errors

  Scenario: Alerts respect the settings toggle
    When I create a terminal
    And I click the settings button
    And I click the activity alerts toggle
    And I press Escape
    And I simulate an activity alert
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Simulated alert shows a toast with a Switch action
    When I create a terminal
    And I create a terminal
    And I simulate an activity alert
    Then a toast should appear with text "finished"
    And the toast should expose a "Switch" action
    And there should be no page errors

  Scenario: Clicking the toast Switch action visits the background terminal
    When I create a terminal
    And I create a terminal
    And I simulate an activity alert
    Then a workspace switcher branch should be notified
    When I click the toast Switch action
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Hidden active terminal badges the PWA dock icon
    When I stub the Badging API
    And I simulate the Kolu tab being hidden
    And I simulate an activity alert for the active terminal
    Then the app badge should show 1
    When I simulate the Kolu tab becoming visible
    Then the app badge should be cleared
    And no workspace switcher branch should be notified
    And there should be no page errors
