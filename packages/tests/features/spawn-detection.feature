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

  # The pid path already works command-rooted (reproduce-first finding): claude
  # resolves by foregroundPid + on-disk session file, independent of the command
  # hint, so a command-rooted claude with a live session IS detected today. The
  # field's invisible claudes were Bug B (env leak → no session file), fixed by
  # PR1. This scenario is a GREEN regression guard that the pid path keeps working
  # for a shell-less agent.
  Scenario: A command-rooted claude with a live session is detected (pid path)
    When a command-rooted claude agent is running with session state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 working pill
    And there should be no page errors

  # The hint path is the actual #1872 bug. An agent whose kernel comm ≠ its name
  # (an npm shim — an `opencode`-named binary execing a `node`-named one) can only
  # be matched via the command it was launched with. With no shell there is no
  # OSC 633;E mark, kaval discards the spawn argv (lock 1), and the shellIdle gate
  # would null the hint anyway (lock 2). RED today; green once both locks open.
