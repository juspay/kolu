Feature: Git worktree management
  Users can create terminals in new git worktrees via the command palette,
  and close terminals while removing the worktree.

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

  Scenario: Close terminal and remove worktree
    When I set up a git repo at "/tmp/kolu-wt-remove"
    And I run "cd /tmp/kolu-wt-remove"
    And the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-remove" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the sidebar entry count
    When I open the command palette
    And I select "Close terminal and remove worktree" in the palette
    Then the sidebar should have 1 fewer terminal entry
    And there should be no page errors

  Scenario: Autolaunch command runs after worktree creation
    When I set the autolaunch command to "pwd; git log --oneline -5"
    And I set up a git repo at "/tmp/kolu-wt-auto"
    And I run "cd /tmp/kolu-wt-auto"
    Then the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-auto" in the palette
    Then the header CWD should show ".worktrees/"
    And the screen state should contain "git log --oneline"
    And there should be no page errors

  Scenario: Configure autolaunch command via palette
    When I set the autolaunch command to "echo HELLO_AUTOLAUNCH"
    And I set up a git repo at "/tmp/kolu-wt-custom"
    And I run "cd /tmp/kolu-wt-custom"
    Then the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-custom" in the palette
    Then the header CWD should show ".worktrees/"
    And the screen state should contain "HELLO_AUTOLAUNCH"
    And there should be no page errors

  Scenario: Disable autolaunch by clearing the command
    When I set the autolaunch command to ""
    And I set up a git repo at "/tmp/kolu-wt-noauto"
    And I run "cd /tmp/kolu-wt-noauto"
    Then the header should show a branch name
    When I open the command palette
    And I select "New worktree" in the palette
    And I select "kolu-wt-noauto" in the palette
    Then the header CWD should show ".worktrees/"
    And the screen state should not contain "git log --oneline"
    And there should be no page errors
