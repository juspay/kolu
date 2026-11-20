Feature: The Conductor keeps a memory you approve
  The Conductor may only propose what to remember. Each proposal waits on
  you: Remember, Edit… or Don't. Everything remembered is on the Memory
  sheet, where you add, edit, delete, export and import by hand. The scripted
  agent proposes made-up memories through kolu's real `memory_propose`; each
  scenario's titles carry a mark of their own, so a memory one scenario
  declined is never one another proposes.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation
    And the Conductor's memory is empty

  Scenario: A proposal waits on you, and Remember keeps it
    When the Conductor proposes to remember "Squash-merge on demo-app"
    Then the conductor transcript should show a waiting memory proposal "Squash-merge on demo-app"
    And the memory chip should say 1 waiting
    And the conductor tab should show a badge of 1
    When I press "Remember" on the memory proposal "Squash-merge on demo-app"
    Then the memory proposal "Squash-merge on demo-app" should say "remembered"
    And the memory chip should be gone
    And the conductor tab should show no badge
    When I open the Memory sheet from the conductor menu
    Then the Memory sheet should list the memory "Squash-merge on demo-app"
    And there should be no page errors

  Scenario: Edit… remembers what you wrote instead
    When the Conductor proposes to remember "Rebase before review"
    And I press "Edit…" on the memory proposal "Rebase before review"
    And I set the memory editor's title to "Rebase on main before review"
    And I save the memory editor
    Then the memory proposal "Rebase before review" should say "remembered, edited"
    When I open the Memory sheet from the conductor menu
    Then the Memory sheet should list the memory "Rebase on main before review"
    And the Memory sheet should not list the memory "Rebase before review"
    And there should be no page errors

  Scenario: A declined proposal is refused when the Conductor proposes it again
    When the Conductor proposes to remember "Prefer rebase over merge"
    And I press "Don't" on the memory proposal "Prefer rebase over merge"
    Then the memory proposal "Prefer rebase over merge" should say "declined"
    When the Conductor proposes to remember "Prefer rebase over merge"
    Then the conductor transcript should show a row of kind "agent" saying "refused: The human declined this on"
    And the memory chip should be gone
    And there should be no page errors

  Scenario: A batch of three is one thing that needs you, drawn as one-line rows
    When I send the conductor the prompt "remember three"
    Then the conductor transcript should show 3 one-line memory proposals
    And the memory chip should say 3 waiting
    And the conductor tab should show a badge of 1
    And there should be no page errors

  Scenario: Add, edit and delete by hand
    When I open the Memory sheet from the conductor menu
    And I add a memory titled "Never merge on a Friday" saying "Hand a green pull request over instead."
    Then the Memory sheet should list the memory "Never merge on a Friday"
    When I edit the memory "Never merge on a Friday" to say "Not even a small one."
    Then the Memory sheet should show "Not even a small one." for the memory "Never merge on a Friday"
    When I delete the memory "Never merge on a Friday"
    Then the Memory sheet should not list the memory "Never merge on a Friday"
    And there should be no page errors

  Scenario: Export, then import into an empty memory
    When I open the Memory sheet from the conductor menu
    And I add a memory titled "Squash-merge on demo-app" saying "Always squash."
    And I export the memory as Markdown
    Then the clipboard should hold the memory "Squash-merge on demo-app"
    When I delete the memory "Squash-merge on demo-app"
    And I import the clipboard's memory file
    Then the import should show 1 new and 0 already remembered
    When I add what the import found
    Then the Memory sheet should list the memory "Squash-merge on demo-app"
    And there should be no page errors

  Scenario: A proposal still waits after the kolu server restarts
    When the Conductor proposes to remember "Squash-merge on demo-app"
    Then the conductor transcript should show a waiting memory proposal "Squash-merge on demo-app"
    When the kolu server is restarted
    And I enter conductor mode
    Then the memory chip should say 1 waiting
    And the conductor transcript should show a waiting memory proposal "Squash-merge on demo-app"
    And there should be no page errors

  Scenario: Bring over from Claude Code asks for proposals, and nothing is kept until you choose
    When I open the Memory sheet from the conductor menu
    And I press Bring over from Claude Code
    Then the Memory sheet should show 3 waiting proposals
    And the Memory sheet should list no memory
    And the memory chip should say 3 waiting
    And there should be no page errors
