@claude-mock
Feature: Command-rooted agent detection (#1872)
  A terminal whose ROOT process IS the agent — `kaval-tui create -- claude …`,
  with no shell wrapping it — must still surface agent activity in the Dock.
  The field regression: three coordinator agents launched this way ran for
  hours invisible, because detection was built around the shell emitting the
  OSC 633 command mark, which a shell-less PTY never sends, and around a
  "shell idle" check that misreads an agent-rooted PTY as an idle prompt.

  Requires KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR (set by the
  harness) so the mocked session resolves against test-controlled directories.

  Background:
    Given the terminal is ready

  Scenario: A command-rooted claude agent surfaces in the dock
    When a command-rooted claude agent is running with session state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 working pill
    And there should be no page errors
