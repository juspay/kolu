Feature: Kill terminal
  Closing terminals via sidebar and auto-switching.

  Scenario: Kill terminal via sidebar close button
    When I open the app
    And I create a workspace
    And I run "echo kill-test-marker"
    And I create a workspace
    And I close workspace 1 via sidebar
    Then the sidebar should have 1 workspace entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Kill active terminal auto-switches to next
    When I open the app
    And I create a workspace
    And I run "echo term-one"
    And I create a workspace
    And I run "echo term-two"
    And I create a workspace
    And I run "echo term-three"
    And I select workspace 2 in the sidebar
    And I close workspace 2 via sidebar
    Then the active workspace should show "term-three"
    And the sidebar should have 2 workspace entries
    And there should be no page errors

  Scenario: Kill last terminal shows empty state
    When I open the app
    And I create a workspace
    And I close workspace 1 via sidebar
    Then the empty state tip should be visible
    And the sidebar should have 0 workspace entries
    And there should be no page errors

  Scenario: Close workspace via command palette
    When I open the app
    And I create a workspace
    And I create a workspace
    And I close the active workspace via command palette
    Then the sidebar should have 1 workspace entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Killed terminal stays gone after browser refresh
    When I open the app
    And I create a workspace
    And I create a workspace
    And I close workspace 1 via sidebar
    Then the sidebar should have 1 workspace entry
    When I refresh the page
    Then the sidebar should have 1 workspace entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Natural PTY exit removes terminal
    When I open the app
    And I create a workspace
    And I create a workspace
    And I select workspace 1 in the sidebar
    And I run "exit"
    Then the sidebar should eventually have 1 workspace entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Natural exit stays gone after browser refresh
    When I open the app
    And I create a workspace
    And I create a workspace
    And I select workspace 1 in the sidebar
    And I run "exit"
    Then the sidebar should eventually have 1 workspace entry
    When I refresh the page
    Then the sidebar should have 1 workspace entry
    And the terminal canvas should be visible
    And there should be no page errors
