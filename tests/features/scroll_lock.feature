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

  Scenario: Clicking scroll-to-bottom returns focus to terminal
    When I generate 100 lines of output
    And I scroll the terminal up
    And I click the scroll-to-bottom button
    Then the terminal input should be focused

  Scenario: Button shows activity when new output arrives while locked
    When I generate 100 lines of output
    And I prepare a output trigger
    And I scroll the terminal up
    Then the scroll-to-bottom button should not be active
    When I fire the output trigger
    Then the scroll-to-bottom button should be active

  Scenario: Scroll lock holds position during buffer trimming
    When I generate 1200 lines of output
    And I prepare a output trigger
    And I scroll the terminal up
    And I note the visible terminal text
    And I fire the output trigger with 200 lines
    Then the visible terminal text should be unchanged

  Scenario: Switching back to a terminal with scrollback auto-scrolls to bottom
    When I create a terminal
    And I generate 200 lines of output
    And I create a terminal
    And I select terminal 1 in the sidebar
    Then the terminal should be scrolled to the bottom

  Scenario: Disabling scroll lock prevents freezing
    When I click the settings button
    And I click the scroll lock toggle
    And I press Escape
    And I generate 100 lines of output
    And I scroll the terminal up
    And I generate 10 more lines of output
    Then the scroll-to-bottom button should not be visible
