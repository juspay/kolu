Feature: Git worktree management
  Users can create terminals in new git worktrees via "New terminal" in the
  command palette, and close terminals while optionally removing the worktree.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  Scenario: Create terminal in a new worktree via command palette
    When I set up a git repo at "/tmp/kolu-wt-test"
    And I run "cd /tmp/kolu-wt-test"
    Then the header CWD should show "/tmp/kolu-wt-test"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-test" in the palette
    Then the header CWD should show ".worktrees/"
    And the pill tree should show a worktree indicator
    And there should be no page errors

  Scenario: Close terminal on worktree shows confirmation and removes worktree
    When I set up a git repo at "/tmp/kolu-wt-remove"
    And I run "cd /tmp/kolu-wt-remove"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-remove" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the pill tree entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I confirm worktree removal
    Then the pill tree should have 1 fewer terminal entry
    And there should be no page errors

  Scenario: Cancel worktree removal keeps the terminal
    When I set up a git repo at "/tmp/kolu-wt-cancel"
    And I run "cd /tmp/kolu-wt-cancel"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-cancel" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the pill tree entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I dismiss the close confirmation
    Then the pill tree entry count should be unchanged
    And there should be no page errors

  Scenario: Close only keeps the worktree on disk
    When I set up a git repo at "/tmp/kolu-wt-close-only"
    And I run "cd /tmp/kolu-wt-close-only"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-close-only" in the palette
    Then the header CWD should show ".worktrees/"
    Given I note the pill tree entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I click close only in the close confirmation
    Then the pill tree should have 1 fewer terminal entry
    And there should be no page errors

  Scenario: Remove option is hidden when another terminal shares the worktree
    When I set up a git repo at "/tmp/kolu-wt-shared"
    And I add a git worktree at "/tmp/kolu-wt-shared/.worktrees/shared-wt" in repo "/tmp/kolu-wt-shared" on branch "shared-wt"
    And I run "cd /tmp/kolu-wt-shared/.worktrees/shared-wt"
    Then the header should show a branch name
    When I create a terminal
    And I run "cd /tmp/kolu-wt-shared/.worktrees/shared-wt"
    Then the header should show a branch name
    Given I note the pill tree entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    And the close confirmation should not offer worktree removal because "sharedWithOtherTerminals"
    When I confirm close all in the close confirmation
    Then the pill tree should have 1 fewer terminal entry
    And there should be no page errors

  # Sub-terminal create-via-palette in a worktree-spawned terminal stalls
  # waiting for [data-sub-terminal] to appear. Reproduces only when the
  # right panel is open AND the parent was created through the worktree
  # palette flow — non-worktree sub-terminal scenarios pass. Skip until
  # the focus path is untangled (post-#622 follow-up).
  @skip
  Scenario: Closing a split terminal in a worktree does not prompt for removal
    When I set up a git repo at "/tmp/kolu-wt-split-close"
    And I run "cd /tmp/kolu-wt-split-close"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-split-close" in the palette
    Then the header CWD should show ".worktrees/"
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    When I close sub-terminal tab 1
    Then the close confirmation should not be visible
    And the sub-panel tab bar should have 1 tab
    And there should be no page errors

  @skip
  Scenario: Worktree terminal with splits shows confirmation and removes all
    When I set up a git repo at "/tmp/kolu-wt-splits"
    And I run "cd /tmp/kolu-wt-splits"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-splits" in the palette
    Then the header CWD should show ".worktrees/"
    When I create a sub-terminal via command palette
    Given I note the pill tree entry count
    When I open the command palette
    And I select "Close terminal" in the palette
    Then the close confirmation should be visible
    When I confirm worktree removal
    Then the pill tree should have 1 fewer terminal entry
    And there should be no page errors
