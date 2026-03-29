Feature: Session restore
  Terminals and their CWDs are saved automatically. When kolu starts
  with no terminals, the empty state offers to restore the previous session.

  Scenario: Restore previous session from empty state
    # Create two terminals in different directories to build a session
    Given the terminal is ready
    When I run "cd /tmp && mkdir -p kolu-session-test-a kolu-session-test-b"
    And I run "cd /tmp/kolu-session-test-a"
    Then the header CWD should show "/tmp/kolu-session-test-a"
    When I create a second terminal
    And I run "cd /tmp/kolu-session-test-b"
    Then the header CWD should show "/tmp/kolu-session-test-b"
    # Kill all terminals server-side to simulate a restart, then reload
    When I kill all terminals and reload
    Then the session restore card should be visible
    And the restore button should mention "2 terminals"
    # Restore the session
    When I click the restore button
    Then there should be 2 sidebar entries
    And there should be no page errors
