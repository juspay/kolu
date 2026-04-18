Feature: Mobile tile swipe
  On mobile the canvas is disabled. The active terminal fills the viewport
  and swipe-left/right cycles between terminals in pill-tree order.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Mobile renders one fullscreen tile
    Then the mobile tile view should be visible
    And there should be no page errors

  @mobile
  Scenario: Swipe left advances to the next terminal
    Given I create a terminal
    And I run "echo second-terminal"
    When I swipe left on the mobile tile view
    Then the active terminal should show "second-terminal"
    And there should be no page errors

  @mobile
  Scenario: Swipe right returns to the previous terminal
    Given I create a terminal
    And I run "echo second-terminal"
    And I swipe left on the mobile tile view
    When I swipe right on the mobile tile view
    Then the active terminal should not show "second-terminal"
    And there should be no page errors
