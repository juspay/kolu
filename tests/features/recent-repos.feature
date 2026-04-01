Feature: Recent repos in worktree dialog
  Users can create worktrees for previously seen repos via "New worktree…"
  in the command palette, without needing an active git terminal.

  Background:
    Given the terminal is ready

  Scenario: Recent repo appears in worktree dialog after visiting a git repo
    When I set up a git repo at "/tmp/kolu-recent-test"
    And I run "cd /tmp/kolu-recent-test"
    Then the header CWD should show "/tmp/kolu-recent-test"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    Then the new worktree dialog should be visible
    And the worktree dialog should show repo "kolu-recent-test"
    And there should be no page errors
