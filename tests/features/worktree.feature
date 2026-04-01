Feature: Git worktree management
  Users can create workspaces in new git worktrees via the command palette,
  and close workspaces while removing the worktree.

  Background:
    Given the terminal is ready

  Scenario: Create workspace in a new worktree via command palette
    When I set up a git repo at "/tmp/kolu-wt-test"
    And I run "cd /tmp/kolu-wt-test"
    Then the header CWD should show "/tmp/kolu-wt-test"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-test" in the palette
    Then the header CWD should show ".worktrees/"
    And the sidebar should show a worktree indicator
    And there should be no page errors

  Scenario: Close workspace and remove worktree
    When I set up a git repo at "/tmp/kolu-wt-remove"
    And I run "cd /tmp/kolu-wt-remove"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-remove" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close workspace and remove worktree" in the palette
    Then the sidebar should have 1 fewer workspace entry
    And there should be no page errors
