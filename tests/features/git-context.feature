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
    And there should be no page errors

  Scenario: Branch updates live when HEAD changes externally
    When I run "git init /tmp/kolu-git-watch"
    And I run "cd /tmp/kolu-git-watch"
    Then the header should show a branch name
    When the branch is switched to "watcher-test" in "/tmp/kolu-git-watch"
    Then the header branch should contain "watcher-test"
    And the sidebar branch should contain "watcher-test"
    And there should be no page errors

  Scenario: Header and sidebar hide git context outside a repo
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    And the header should not show git context
    And the sidebar should not show git context
    And there should be no page errors
