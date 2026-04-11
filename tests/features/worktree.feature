Feature: Git worktree management
  Users can create terminals in new git worktrees via "New terminal" in the
  command palette, and close terminals while optionally removing the worktree.

  Background:
    Given the terminal is ready

  Scenario: Create terminal in a new worktree via command palette
    When I set up a git repo at "/tmp/kolu-wt-test"
    And I run "cd /tmp/kolu-wt-test"
    Then the header CWD should show "/tmp/kolu-wt-test"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-test" in the palette
    Then the new worktree dialog should be visible
    When I submit the new worktree dialog
    Then the header CWD should show ".worktrees/"
    And the sidebar should show a worktree indicator
    And there should be no page errors

  Scenario: New worktree dialog lets user rename the branch before creation
    When I set up a git repo at "/tmp/kolu-wt-rename"
    And I run "cd /tmp/kolu-wt-rename"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-rename" in the palette
    Then the new worktree dialog should be visible
    When I set the new worktree branch name to "fix-login-bug"
    And I submit the new worktree dialog
    Then the header CWD should show ".worktrees/fix-login-bug"
    And there should be no page errors

  Scenario: New worktree dialog shows server error inline on branch collision
    When I set up a git repo at "/tmp/kolu-wt-collide"
    And I run "cd /tmp/kolu-wt-collide"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-collide" in the palette
    Then the new worktree dialog should be visible
    When I set the new worktree branch name to "master"
    And I click create in the new worktree dialog
    Then the new worktree dialog should show error containing "master"
    And the new worktree dialog should be visible
    And there should be no page errors

  Scenario: New worktree dialog auto-runs a configured command
    When I set up a git repo at "/tmp/kolu-wt-autorun"
    And I run "cd /tmp/kolu-wt-autorun"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-autorun" in the palette
    Then the new worktree dialog should be visible
    When I set the new worktree auto-run command to "echo worktree-autorun-marker"
    And I submit the new worktree dialog
    Then the header CWD should show ".worktrees/"
    And the screen state should contain "worktree-autorun-marker"
    And there should be no page errors

  Scenario: Close terminal on worktree shows confirmation and removes worktree
    When I set up a git repo at "/tmp/kolu-wt-remove"
    And I run "cd /tmp/kolu-wt-remove"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-remove" in the palette
    Then the new worktree dialog should be visible
    When I submit the new worktree dialog
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I confirm worktree removal
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors

  Scenario: Cancel worktree removal keeps the terminal
    When I set up a git repo at "/tmp/kolu-wt-cancel"
    And I run "cd /tmp/kolu-wt-cancel"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-cancel" in the palette
    Then the new worktree dialog should be visible
    When I submit the new worktree dialog
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I dismiss the close confirmation
    Then the sidebar entry count should be unchanged
    And there should be no page errors

  Scenario: Close only keeps the worktree on disk
    When I set up a git repo at "/tmp/kolu-wt-close-only"
    And I run "cd /tmp/kolu-wt-close-only"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-close-only" in the palette
    Then the new worktree dialog should be visible
    When I submit the new worktree dialog
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I click close only in the close confirmation
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors

  Scenario: Worktree terminal with splits shows confirmation and removes all
    When I set up a git repo at "/tmp/kolu-wt-splits"
    And I run "cd /tmp/kolu-wt-splits"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-splits" in the palette
    Then the new worktree dialog should be visible
    When I submit the new worktree dialog
    Then the header CWD should show ".worktrees/"
    When I create a sub-terminal via command palette
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I confirm worktree removal
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors
