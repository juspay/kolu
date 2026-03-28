Feature: Git context in header and sidebar
  When the active terminal is inside a git repo, the header and sidebar
  show the branch name alongside the CWD.

  Background:
    Given the terminal is ready

  Scenario: Header and sidebar show branch in a git repo
    When I run "git init /tmp/kolu-git-test"
    And I run "cd /tmp/kolu-git-test"
    Then the header should show a branch name
    And the sidebar should show a branch name
    And the sidebar label should show "kolu-git-test"
    And the sidebar should not show a worktree indicator
    And there should be no page errors

  Scenario: Branch updates live when HEAD changes externally
    When I run "git init /tmp/kolu-git-watch"
    And I run "cd /tmp/kolu-git-watch"
    Then the header should show a branch name
    When the branch is switched to "watcher-test" in "/tmp/kolu-git-watch"
    Then the header branch should contain "watcher-test"
    And the sidebar branch should contain "watcher-test"
    And there should be no page errors

  Scenario: Git worktree shows its own branch and main repo name
    When I run "git init /tmp/kolu-wt-main && cd /tmp/kolu-wt-main && git commit --allow-empty -m init"
    And I run "cd /tmp/kolu-wt-main"
    Then the header should show a branch name
    And the sidebar label should show "kolu-wt-main"
    When I run "git worktree add -b feature-branch /tmp/kolu-wt-feature"
    And I run "cd /tmp/kolu-wt-feature"
    Then the header branch should contain "feature-branch"
    And the sidebar branch should contain "feature-branch"
    And the sidebar label should show "kolu-wt-main"
    And the sidebar should show a worktree indicator
    And there should be no page errors

  Scenario: CWD inside .worktrees parent dir shows main repo name
    When I run "git init /tmp/kolu-wt-parent && cd /tmp/kolu-wt-parent && git commit --allow-empty -m init"
    And I run "mkdir -p /tmp/kolu-wt-parent/.worktrees && git -C /tmp/kolu-wt-parent worktree add -b wt-branch /tmp/kolu-wt-parent/.worktrees/wt-branch"
    And I run "cd /tmp/kolu-wt-parent/.worktrees"
    Then the sidebar label should show "kolu-wt-parent"
    And the sidebar should not show a worktree indicator
    And there should be no page errors

  Scenario: Git init in an empty directory shows branch in sidebar
    When I run "mkdir -p /tmp/kolu-git-init-test && cd /tmp/kolu-git-init-test"
    And I run "git init"
    Then the header should show a branch name
    And the sidebar should show a branch name
    When I run "git checkout -b test-branch"
    Then the header branch should contain "test-branch"
    And the sidebar branch should contain "test-branch"
    And there should be no page errors

  Scenario: Header and sidebar hide git context outside a repo
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    And the header should not show git context
    And the sidebar should not show git context
    And there should be no page errors
