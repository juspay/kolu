Feature: Multiple terminals
  Create, switch, and kill terminals via sidebar.

  Scenario: Create and switch between terminals with distinct output
    Given I create a terminal
    And the terminal is ready
    When I run "echo hello-from-t1"
    And I create another terminal
    And the terminal is ready
    And I run "echo hello-from-t2"
    When I switch to the first terminal in the sidebar
    And I wait for the terminal to settle
    Then the terminal canvas should be visible
    And there should be no page errors

  Scenario: Sidebar shows terminals
    Given I create a terminal
    And I create another terminal
    Then the sidebar should show 2 terminals

  Scenario: Kill a terminal
    Given I create a terminal
    And the terminal is ready
    When I kill the last created terminal via the sidebar
    And I wait for status to update
    Then the killed terminal should be removed

  Scenario: Switching terminals should not mix output
    Given I create a terminal
    And the terminal is ready
    And I run "for i in $(seq 1 50); do echo MARKER_TERM_A_LINE_$i; done"
    And I create another terminal
    And the terminal is ready
    Then there should be exactly 1 visible canvas on the page
