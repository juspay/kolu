@layout-compact
Feature: Session restore
  Terminals and their CWDs are saved automatically. When kolu starts
  with no terminals, the empty state offers to restore the previous session.

  Scenario: Restore previous session from empty state
    # Seed a known session on the server (no timing dependency on auto-save)
    Given a saved session with 2 terminals
    When I open the app
    Then the session restore card should be visible
    And the restore button should mention "2 terminals"
    When I click the restore button
    Then there should be 2 sidebar entries
    And there should be no page errors

  Scenario: Restored terminals preserve their original sidebar order
    Given a saved session with reversed sort order
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 3 sidebar entries
    And the sidebar entries should be in sort order
    And there should be no page errors

  Scenario: Restored terminals preserve their theme
    Given a saved session with theme "Dracula"
    When I open the app
    Then the session restore card should be visible
    When I click the restore button
    Then there should be 1 sidebar entries
    And the header should show theme "Dracula"
    And there should be no page errors

  Scenario: Active terminal persists across refresh
    When I open the app
    And I create a terminal
    And I create a terminal
    And I select terminal 2 in the sidebar
    And I wait for the session auto-save
    And I reload the page and wait for ready
    Then sidebar entry 2 should be active
    And there should be no page errors
