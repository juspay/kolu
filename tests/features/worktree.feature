Feature: Git worktree management
  Users can create terminals in new git worktrees via the command palette,
  and close terminals while optionally removing the worktree.

  Background:
    Given the terminal is ready

  Scenario: Create terminal in a new worktree via command palette
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

  Scenario: Close terminal on worktree shows confirmation and removes worktree
    When I set up a git repo at "/tmp/kolu-wt-remove"
    And I run "cd /tmp/kolu-wt-remove"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-remove" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the worktree remove confirmation should be visible
    When I confirm worktree removal
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors

  Scenario: Cancel worktree removal keeps the terminal
    When I set up a git repo at "/tmp/kolu-wt-cancel"
    And I run "cd /tmp/kolu-wt-cancel"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-cancel" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the worktree remove confirmation should be visible
    When I dismiss the worktree remove confirmation
    Then the sidebar entry count should be unchanged
    And there should be no page errors

  Scenario: Close only keeps the worktree on disk
    When I set up a git repo at "/tmp/kolu-wt-close-only"
    And I run "cd /tmp/kolu-wt-close-only"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-close-only" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the worktree remove confirmation should be visible
    When I click close only in the worktree confirmation
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors
