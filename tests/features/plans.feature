@claude-mock
Feature: Plan detection and inline commenting
  When Claude Code is running in a terminal and a plan file exists in
  the project's .claude/plans/ directory, the plan pane auto-appears
  alongside the terminal with inline feedback commenting.

  Background:
    Given the terminal is ready

  Scenario: Plan pane auto-appears when Claude has a plan file
    Given a project directory with a plan file "dreamy-nebula"
    When a Claude Code session is mocked in the project directory
    Then the plan pane should be visible
    And the plan pane should show the plan name "dreamy-nebula"
    And there should be no page errors

  Scenario: Plan pane shows sections from the plan file
    Given a project directory with a structured plan file "arch-review"
    When a Claude Code session is mocked in the project directory
    Then the plan pane should show at least 2 sections
    And there should be no page errors

  Scenario: Adding feedback to a plan section
    Given a project directory with a structured plan file "refactor-plan"
    When a Claude Code session is mocked in the project directory
    And I add feedback "Use the existing helper" to the first section
    Then the plan file should contain feedback "Use the existing helper"
    And there should be no page errors

  Scenario: Plan pane disappears when Claude session ends
    Given a project directory with a plan file "temp-plan"
    When a Claude Code session is mocked in the project directory
    Then the plan pane should be visible
    When the Claude Code session ends
    Then the plan pane should not be visible
    And there should be no page errors

  Scenario: New plan file detected while Claude is running
    Given a project directory with no plan files
    When a Claude Code session is mocked in the project directory
    Then the plan pane should not be visible
    When a new plan file "fresh-plan" is added to the project
    Then the plan pane should be visible
    And there should be no page errors
