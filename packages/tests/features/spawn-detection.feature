@claude-mock
Feature: Command-rooted agent detection (#1872)
  A terminal whose ROOT process IS the agent — `kaval-tui create -- <agent> …`,
  with no shell wrapping it — must still surface agent activity in the Dock.
  The field regression: coordinator agents launched this way ran for hours
  invisible.

  Reproduce-first found the two paths behave differently, so both are pinned:

  Requires KOLU_CLAUDE_SESSIONS_DIR / KOLU_CLAUDE_PROJECTS_DIR / KOLU_OPENCODE_DB
  (set by the harness) so the mocked sessions resolve against test directories.

  Background:
    Given the terminal is ready

  Scenario: A command-rooted claude with a live session is detected (pid path)
    When a command-rooted claude agent is running with session state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 working pill
    And there should be no page errors

  Scenario: A command-rooted opencode npm shim is detected via its command (hint path)
    When a command-rooted opencode agent is running as an npm shim with session state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 working pill
    And there should be no page errors
