Feature: Git worktree management
  Users can create terminals in new git worktrees via the command palette,
  and close terminals while removing the worktree.

  Background:
    Given the terminal is ready

  Scenario: Create terminal in a new worktree via dialog
    When I set up a git repo at "/tmp/kolu-wt-test"
    And I run "cd /tmp/kolu-wt-test"
    Then the header CWD should show "/tmp/kolu-wt-test"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    Then the new worktree dialog should be visible
    When I select repo "kolu-wt-test" in the worktree dialog
    And I click the worktree create button
    Then the header CWD should show ".worktrees/"
    And the sidebar should show a worktree indicator
    And there should be no page errors

  Scenario: Create worktree with Claude Code agent
    When I set up a git repo at "/tmp/kolu-wt-agent"
    And I run "cd /tmp/kolu-wt-agent"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    Then the new worktree dialog should be visible
    When I select agent "Claude Code" in the worktree dialog
    And I select repo "kolu-wt-agent" in the worktree dialog
    And I click the worktree create button
    Then the header CWD should show ".worktrees/"
    And there should be no page errors

  Scenario: Close terminal and remove worktree
    When I set up a git repo at "/tmp/kolu-wt-remove"
    And I run "cd /tmp/kolu-wt-remove"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    Then the new worktree dialog should be visible
    When I select repo "kolu-wt-remove" in the worktree dialog
    And I click the worktree create button
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal and remove worktree" in the palette
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors
