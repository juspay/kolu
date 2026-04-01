Feature: Workspace activity indicator
  Sidebar shows active (green) vs sleeping (grey) status for each workspace.

  Scenario: New workspace starts active then becomes sleeping
    When I open the app
    And I create a workspace
    Then the workspace should show as active
    When I wait for the workspace to become idle
    Then the workspace should show as sleeping

  Scenario: Running a command makes a sleeping workspace active
    When I open the app
    And I create a workspace
    And I wait for the workspace to become idle
    Then the workspace should show as sleeping
    When I run "echo hello"
    Then the workspace should show as active

  Scenario: Multiple workspaces show independent activity states
    When I open the app
    And I create a workspace
    And I create a workspace
    And I wait for the workspace to become idle
    Then workspace 1 should show as sleeping
    And workspace 2 should show as sleeping
    When I select workspace 1 in the sidebar
    And I run "echo wakeup"
    Then workspace 1 should show as active
    And workspace 2 should show as sleeping
