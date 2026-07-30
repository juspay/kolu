Feature: Scroll lock
  Prevents auto-scroll when user scrolls up during continuous output.

  Background:
    Given the terminal is ready

  Scenario: Scroll-to-bottom button appears when scrolled up
    When I generate 100 lines of output
    And I scroll the terminal up
    Then the scroll-to-bottom button should be visible

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

  Scenario: Scroll lock holds position during buffer trimming
    When I generate 1200 lines of output
    And I prepare a output trigger
    And I scroll the terminal up
    And I note the visible terminal text
    And I fire the output trigger with 200 lines
    Then the visible terminal text should be unchanged

  Scenario: Returning to the tab releases a lock engaged while hidden
    # #1272: a lock that engaged while the tab was backgrounded must not
    # present as "terminal frozen until keypress" when the user comes back —
    # tab return flushes and rejoins the bottom, mirroring the existing
    # "switching back to a terminal auto-scrolls to bottom" semantics. (A lock
    # the user made with the tab in front is preserved — covered by unit tests,
    # since Playwright can't hold a real foreground scroll across a synthetic
    # visibility flip.)
    When I generate 100 lines of output
    And I prepare a output trigger
    And the browser tab is backgrounded
    And I scroll the terminal up
    And I fire the output trigger
    And the browser tab becomes visible again
    Then the terminal should be scrolled to the bottom
    And the terminal buffer should contain "triggered-10"
    And the scroll-to-bottom button should not be visible
