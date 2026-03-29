Feature: Activity Alerts
  Highlight sidebar entry when a background terminal has unseen activity.
  Alerts only fire for activity the user hasn't seen.

  Background:
    Given the terminal is ready

  Scenario: Unseen activity in background terminal triggers alert
    When I create a terminal
    And I run "sleep 2 && echo unseen-output" in the background
    And I click sidebar entry 1
    Then sidebar entry 2 should be notified
    And there should be no page errors

  Scenario: Visiting an alerted terminal clears the highlight
    When I create a terminal
    And I run "sleep 2 && echo unseen-clear" in the background
    And I click sidebar entry 1
    Then sidebar entry 2 should be notified
    When I click sidebar entry 2
    Then sidebar entry 2 should not be notified
    And there should be no page errors

  Scenario: Seen activity does NOT trigger alert
    When I run "echo seen-output"
    Then sidebar entry 1 should not be notified within 10 seconds
    And there should be no page errors

  Scenario: Disabling activity alerts prevents highlight
    When I click the settings button
    And I click the activity alerts toggle
    And I press Escape
    And I create a terminal
    And I run "sleep 2 && echo unseen-disabled" in the background
    And I click sidebar entry 1
    Then sidebar entry 2 should not be notified within 10 seconds
    And there should be no page errors
