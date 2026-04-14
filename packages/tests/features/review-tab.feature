Feature: Review tab (diff review)
  The Review tab lists files changed for the terminal's repo and renders
  the unified diff for a selected file. Phase 1 (#514) shipped "local"
  mode (working tree vs HEAD); phase 2 adds a "branch" toggle (working
  tree vs merge-base with origin/<defaultBranch>).

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  Scenario: Review tab is present and switchable
    When I click the Review tab
    Then the Review tab should be active

  Scenario: Shows "not a git repo" message outside a repo
    When I run "cd /tmp"
    And I click the Review tab
    Then the Review tab should indicate no git repository

  Scenario: Shows "no changes" when the repo is clean
    When I run "git init /tmp/kolu-review-clean && cd /tmp/kolu-review-clean"
    And I run "git commit --allow-empty -m init"
    And I click the Review tab
    Then the Review tab should show the empty-changes message

  Scenario: Mode toggle defaults to Local
    When I run "git init /tmp/kolu-review-toggle && cd /tmp/kolu-review-toggle"
    And I run "git commit --allow-empty -m init"
    And I click the Review tab
    Then the Review tab mode should be "local"

  Scenario: Branch mode surfaces an actionable error when origin is missing
    When I run "git init /tmp/kolu-review-no-origin && cd /tmp/kolu-review-no-origin"
    And I run "git commit --allow-empty -m init"
    And I click the Review tab
    And I click the Review tab mode label
    Then the Review tab mode should be "branch"
    And the Review tab should show a missing-origin error

  Scenario: Lists changed files and opens a diff on click
    When I run "git init /tmp/kolu-review-dirty && cd /tmp/kolu-review-dirty"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\n' > note.txt"
    And I click the Review tab
    And I click the refresh button in the Review tab
    Then the Review tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Review tab
    Then the Review tab should render a diff view
    When I click the changed file "note.txt" in the Review tab
    Then the Review tab should not render a diff view
