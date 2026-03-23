Feature: Git context in header
  When the active terminal is inside a git repo, the header shows
  the repo name and branch alongside the CWD.

  Background:
    Given the terminal is ready

  Scenario: Header shows repo name and branch in a git repo
    When I run "git init /tmp/kolu-git-test"
    And I run "cd /tmp/kolu-git-test"
    Then the header should show repo "kolu-git-test"
    And the header should show a branch name
    And there should be no page errors

  Scenario: Header hides git context outside a repo
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    And the header should not show git context
    And there should be no page errors
