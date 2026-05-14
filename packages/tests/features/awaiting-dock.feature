@claude-mock
Feature: Awaiting dock
  When an agent is awaiting user input, a docked strip at the bottom of
  the canvas surfaces it ambiently — no popup required. Each card carries
  the terminal's recent output and a reply input wired to the PTY.

  Background:
    Given the terminal is ready

  Scenario: Dock surfaces awaiting Claude session
    When a Claude Code session is mocked with state "waiting"
    Then the awaiting dock should be visible
    And the awaiting dock should show 1 card

  Scenario: Dock hides when no agent is awaiting
    Then the awaiting dock should not be visible
    When a Claude Code session is mocked with state "thinking"
    Then the awaiting dock should not be visible
