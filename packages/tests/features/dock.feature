@claude-mock
Feature: Dock
  Left-edge canonical live-terminal navigator. Cards mode is the
  default — awaiting agents get full cards with a tail preview + reply
  input, working agents get compact pills, idle/parked terminals get
  faded one-liners. Rail mode collapses every row to a single colored
  swatch. Mega mode embeds the workspace search panel inline.

  Background:
    Given the terminal is ready

  Scenario: Dock defaults to cards mode on first open
    Then the dock should be visible
    And the dock should default to cards mode

  Scenario: Dock surfaces awaiting Claude session as a full card
    When a Claude Code session is mocked with state "waiting"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 card

  Scenario: Dock surfaces working Claude session as a compact pill
    When a Claude Code session is mocked with state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 0 cards
    And the dock should show 1 working pill

  Scenario: Dock collapses to rail and expands back to cards
    When I collapse the dock to rail
    Then the dock should be in "rail" mode
    When the dock is expanded
    Then the dock should be in "cards" mode
