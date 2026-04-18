Feature: Pill tree (terminal switcher)
  The floating two-level pill tree replaces the focus-mode sidebar.
  Repos are the top level, branches the second level. Sits on the canvas
  ghosted at rest; click a branch pill to pan and activate that tile.

  Background:
    Given the terminal is ready

  Scenario: Pill tree appears on the canvas
    Then the pill tree should be visible
    And there should be no page errors

  Scenario: Pill tree shows one branch pill per terminal
    Given I create a terminal
    Then the pill tree should have 2 branch pills
    And there should be no page errors

  Scenario: Active terminal's pill is marked active
    Given I create a terminal
    Then the second pill tree branch should be the active pill
    And there should be no page errors

  Scenario: Clicking a branch pill switches the active terminal
    Given I create a terminal
    And I run "echo first-pill"
    And I create a terminal
    When I click pill tree branch 1
    Then the active terminal should show "first-pill"
    And there should be no page errors

  @mobile
  Scenario: Pill tree is not rendered on mobile
    Then the pill tree should not be visible
    And there should be no page errors
