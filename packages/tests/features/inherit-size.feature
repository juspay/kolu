Feature: New terminal inherits active terminal's size
  When a new terminal is created, it inherits the width and height of the
  currently active terminal — not the default size, and not the last-created
  terminal's size. This guards against the `resolveReferenceLayout` bug that
  walked tileIds backwards and picked the "last" terminal instead of the
  "active" one.

  Background:
    Given the terminal is ready

  Scenario: New terminal inherits active terminal's size, not last terminal's
    Given I create a terminal
    And I create a terminal
    When I resize created terminal 1 to width 1000 and height 700
    And I click created terminal 1
    And I create a terminal
    Then there should be 4 canvas tiles
    And created terminal 3 should have width 1000 and height 700
    And there should be no page errors

  Scenario: Successive creates chain the inherited size
    Given I create a terminal
    When I resize created terminal 1 to width 1100 and height 600
    And I create a terminal
    Then created terminal 2 should have width 1100 and height 600
    And there should be no page errors
