Feature: Scroll lock
  Prevents auto-scroll when user scrolls up during continuous output.

  Background:
    Given the terminal is ready

  Scenario: Scroll-to-bottom button appears when scrolled up
    When I generate 100 lines of output
    And I scroll the terminal up
    Then the scroll-to-bottom button should be visible

  Scenario: Clicking scroll-to-bottom dismisses the button
    When I generate 100 lines of output
    And I scroll the terminal up
    Then the scroll-to-bottom button should be visible
    When I click the scroll-to-bottom button
    Then the scroll-to-bottom button should not be visible

  Scenario: New output does not yank viewport when scroll-locked
    When I generate 100 lines of output
    And I scroll the terminal up
    And I note the scroll position
    And I generate 10 more lines of output
    Then the scroll position should be unchanged

  Scenario: Disabling scroll lock prevents freezing
    When I click the settings button
    And I click the scroll lock toggle
    And I press Escape
    And I generate 100 lines of output
    And I scroll the terminal up
    And I generate 10 more lines of output
    Then the scroll-to-bottom button should not be visible
