Feature: Git context in header and workspace switcher
  When the active terminal is inside a git repo, the header and workspace switcher
  show the branch name alongside the CWD.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  Scenario: Header and workspace switcher show branch in a git repo
    When I run "git init /tmp/kolu-git-test"
    And I run "cd /tmp/kolu-git-test"
    Then the header should show a branch name
    And the workspace switcher should show a branch name
    And the workspace switcher label should show "kolu-git-test"
    And the workspace switcher should not show a worktree indicator
    And there should be no page errors

  Scenario: Branch updates live when HEAD changes externally
    When I run "git init /tmp/kolu-git-watch"
    And I run "cd /tmp/kolu-git-watch"
    Then the header should show a branch name
    When the branch is switched to "watcher-test" in "/tmp/kolu-git-watch"
    Then the header branch should contain "watcher-test"
    And the workspace switcher branch should contain "watcher-test"
    And there should be no page errors

  Scenario: Git worktree shows its own branch and main repo name
    When I run "git init /tmp/kolu-wt-main && cd /tmp/kolu-wt-main && git commit --allow-empty -m init"
    And I run "cd /tmp/kolu-wt-main"
    Then the header should show a branch name
    And the workspace switcher label should show "kolu-wt-main"
    When I run "git worktree add -b feature-branch /tmp/kolu-wt-feature"
    And I run "cd /tmp/kolu-wt-feature"
    Then the header branch should contain "feature-branch"
    And the workspace switcher branch should contain "feature-branch"
    And the workspace switcher label should show "kolu-wt-main"
    And the workspace switcher should show a worktree indicator
    And there should be no page errors

  Scenario: CWD inside .worktrees parent dir shows main repo name
    When I run "git init /tmp/kolu-wt-parent && cd /tmp/kolu-wt-parent && git commit --allow-empty -m init"
    And I run "mkdir -p /tmp/kolu-wt-parent/.worktrees && git -C /tmp/kolu-wt-parent worktree add -b wt-branch /tmp/kolu-wt-parent/.worktrees/wt-branch"
    And I run "cd /tmp/kolu-wt-parent/.worktrees"
    Then the workspace switcher label should show "kolu-wt-parent"
    And the workspace switcher should not show a worktree indicator
    And there should be no page errors

  Scenario: Git init in an empty directory shows branch in workspace switcher
    When I run "mkdir -p /tmp/kolu-git-init-test && cd /tmp/kolu-git-init-test"
    And I run "git init"
    Then the header should show a branch name
    And the workspace switcher should show a branch name
    When I run "git checkout -b test-branch"
    Then the header branch should contain "test-branch"
    And the workspace switcher branch should contain "test-branch"
    And there should be no page errors

  # @skip-darwin: this exercises an *external* `git init` (a separate process,
  # no shell OSC 7) detected purely by the cwd `.git`-appears watcher. On macOS
  # the kolu server cannot observe the externally-created `.git` (accessSync and
  # `git rev-parse` both report "not a repo") until an FSEvent invalidates its
  # directory cache — and the cwd watcher's `fs.watch` delivers that event only
  # intermittently (<~10% across repeated runs; verified on the aarch64-darwin
  # host). No test-side recovery can force the cache to settle. The realistic
  # flow — running `git init` in the kolu shell, which re-emits OSC 7 — is
  # covered by "Git init in an empty directory…" above and runs on every
  # platform. Tracked for a reliable-watcher fix on darwin.
  @skip-darwin
  Scenario: Git context updates when .git appears in cwd without an OSC 7 re-emit
    When I run "rm -rf /tmp/kolu-osc7-less-init && mkdir -p /tmp/kolu-osc7-less-init && cd /tmp/kolu-osc7-less-init"
    Then the header should not show git context
    When a git repo is initialized externally in "/tmp/kolu-osc7-less-init"
    Then the header should show a branch name
    And the workspace switcher should show a branch name
    And there should be no page errors

  Scenario: Clicking the title annotation slot reveals the Notes tab editor
    When I run "rm -rf /tmp/kolu-title-click && git init /tmp/kolu-title-click && cd /tmp/kolu-title-click && git checkout -b annot-branch"
    Then the workspace switcher branch should contain "annot-branch"
    When I click the terminal title branch
    Then the notes editor should be visible
    When I double-click the terminal title branch
    Then no canvas tile should be maximized
    And there should be no page errors

  Scenario: Workspace switcher does not show PR info on default branch
    When I run "git init /tmp/kolu-pr-default && cd /tmp/kolu-pr-default"
    Then the header should show a branch name
    And the workspace switcher should not show PR info
    And there should be no page errors

  Scenario: Header and workspace switcher hide git context outside a repo
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    And the header should not show git context
    And the workspace switcher should not show git context
    And there should be no page errors
