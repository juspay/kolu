Feature: Recent repos in command palette
  Users can create worktrees for previously seen repos via "New terminal"
  in the command palette, without needing an active git terminal.

  Background:
    Given the terminal is ready

  Scenario: Recent repo appears in "New terminal" picker after visiting a git repo
    When I set up a git repo at "/tmp/kolu-recent-test"
    And I run "cd /tmp/kolu-recent-test"
    Then the header CWD should show "/tmp/kolu-recent-test"
    And the header should show a branch name
    When I open the command palette
    And I select "New terminal" in the palette
    Then the palette breadcrumb should show "New terminal"
    And palette item "kolu-recent-test" should be visible
    And no palette hint should be visible
    And there should be no page errors

  Scenario: "New terminal" picker shows a hint when no recent repos exist
    When I open the command palette
    And I select "New terminal" in the palette
    Then the palette breadcrumb should show "New terminal"
    And palette hint "Repos you cd into will appear here" should be visible
    And there should be no page errors
