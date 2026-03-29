Feature: CWD-aware terminal creation
  Users can create a new terminal that starts in the active terminal's
  current working directory, via command palette or keyboard shortcut.

  Background:
    Given the terminal is ready

  Scenario: Create terminal in current directory via command palette
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    When I open the command palette
    And I select "Create terminal in" in the palette
    And I select "Current directory" in the palette
    Then the header CWD should show "/tmp"
    And there should be no page errors

  Scenario: Create terminal in current directory via keyboard shortcut
    When I run "cd /tmp"
    Then the header CWD should show "/tmp"
    When I press the create terminal in cwd shortcut
    Then the header CWD should show "/tmp"
    And there should be no page errors
