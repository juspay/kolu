Feature: Multiple terminals
  Create, switch, and kill terminals via sidebar.

  Scenario: Create and switch between terminals with distinct output
    Given I create a terminal with id "t1" and label "Terminal 1"
    And the terminal is ready
    When I run "echo hello-from-t1"
    And I create a terminal with id "t2" and label "Terminal 2"
    And the terminal is ready
    And I run "echo hello-from-t2"
    When I switch to terminal "t1" in the sidebar
    And I wait for the terminal to settle
    Then the terminal canvas should be visible
    And there should be no page errors

  Scenario: Sidebar shows terminals
    Given I create a terminal with id "t1" and label "Alpha"
    And I create a terminal with id "t2" and label "Beta"
    Then the sidebar should show 2 terminals

  Scenario: Kill a terminal
    Given I create a terminal with id "t1" and label "Terminal 1"
    And the terminal is ready
    When I kill terminal "t1" via the sidebar
    And I wait for status to update
    Then terminal "t1" should show exited status in the sidebar

  Scenario: Reject duplicate terminal IDs
    Given I create a terminal with id "t1" and label "Terminal 1"
    When I try to create a terminal with id "t1" and label "Duplicate"
    Then the creation should fail with conflict error
