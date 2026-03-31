Feature: Plan detection and inline commenting
  When a Claude Code plan file exists in the terminal's project plan directory,
  it appears in the sidebar and can be opened for inline feedback.

  Background:
    Given the terminal is ready

  Scenario: Plan files appear in the sidebar when terminal is in a project with plans
    Given a project directory with a plan file "dreamy-nebula"
    When I cd into the project directory
    Then the sidebar should show a plan entry "dreamy-nebula"
    And there should be no page errors

  Scenario: Clicking a plan entry opens the plan pane
    Given a project directory with a plan file "bold-summit"
    When I cd into the project directory
    Then the sidebar should show a plan entry "bold-summit"
    When I click the plan entry "bold-summit"
    Then the plan pane should be visible
    And the plan pane should show the plan name "bold-summit"
    And there should be no page errors

  Scenario: Plan pane shows sections from the plan file
    Given a project directory with a structured plan file "arch-review"
    When I cd into the project directory
    Then the sidebar should show a plan entry "arch-review"
    When I click the plan entry "arch-review"
    Then the plan pane should show at least 2 sections
    And there should be no page errors

  Scenario: Adding feedback to a plan section
    Given a project directory with a structured plan file "refactor-plan"
    When I cd into the project directory
    Then the sidebar should show a plan entry "refactor-plan"
    When I click the plan entry "refactor-plan"
    And I add feedback "Use the existing helper" to the first section
    Then the plan file should contain feedback "Use the existing helper"
    And there should be no page errors

  Scenario: Closing the plan pane
    Given a project directory with a plan file "temp-plan"
    When I cd into the project directory
    Then the sidebar should show a plan entry "temp-plan"
    When I click the plan entry "temp-plan"
    Then the plan pane should be visible
    When I close the plan pane
    Then the plan pane should not be visible
    And there should be no page errors

  Scenario: New plan file detected after initial load
    Given a project directory with a plan file "first-plan"
    When I cd into the project directory
    Then the sidebar should show a plan entry "first-plan"
    When a new plan file "second-plan" is added to the project
    Then the sidebar should show a plan entry "second-plan"
    And there should be no page errors
