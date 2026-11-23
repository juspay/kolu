Feature: TEMPORARY trace of the transcript following after a work is picked and left

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: Copy 1 (two) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "two"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 2 (two) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "two"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 3 (probe-3) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "probe-3"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 4 (probe-4) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "probe-4"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 5 (probe-5) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "probe-5"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 6 (probe-6) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "probe-6"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 7 (probe-7) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "probe-7"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom

  Scenario: Copy 8 (probe-8) picking a work and going back leaves a following chat at the bottom
    When I create a terminal
    And I enter conductor mode
    And I send the conductor the prompt "say a lot"
    Then the conductor transcript should show a row of kind "agent" saying "line 30"
    And the conductor transcript should be scrolled to the bottom
    When I ask the conductor to open the work "probe-8"
    Then the conductor transcript should be scrolled to the bottom
    When I open the work card
    And I go back to all the works
    Then the conductor transcript should be scrolled to the bottom
    And the conductor should not offer the way back to the bottom
