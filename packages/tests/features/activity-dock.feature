@claude-mock
Feature: Activity dock
  Top-left column surfacing active agents. Awaiting agents get full
  cards with a tail preview + reply input; working agents get compact
  pills. Parked (stale) agents are filtered out.

  Background:
    Given the terminal is ready

  Scenario: Dock surfaces awaiting Claude session as a full card
    When a Claude Code session is mocked with state "waiting"
    Then the awaiting dock should be visible
    When the awaiting dock is expanded
    Then the awaiting dock should show 1 card

  Scenario: Dock surfaces working Claude session as a compact pill
    When a Claude Code session is mocked with state "thinking"
    Then the awaiting dock should be visible
    When the awaiting dock is expanded
    Then the awaiting dock should show 0 cards
    And the awaiting dock should show 1 working pill

  Scenario: Dock hides when no agent is active
    Then the awaiting dock should not be visible
