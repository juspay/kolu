Feature: Local PTY daemon reattach (#951 R4c)
  Local terminals run in a detached `kolu --stdio` PTY-host daemon, so they
  survive a kolu-server restart — replacing tmux/zmx, closing #671. After the
  server restarts, the same shells reattach by id with scrollback intact (no
  re-spawn, no lost output), and kolu-server runs a FRESH provider DAG against
  the surviving PTYs — so git context, agent detection, and sub-terminal
  grouping all re-resolve, not serve stale state.

  This suite parametrizes the assertions of the regular feature tests
  (git-context, claude-code, sub-terminal) under a mid-scenario server restart
  — the #1031 dropped attempt only checked scrollback and missed the metadata
  + agent-detection + grouping regressions that broke in production.

  Scenario: Scrollback survives a kolu-server restart
    Given the terminal is ready
    When I run "echo kolu-survives-restart"
    Then the screen state should contain "kolu-survives-restart"
    When I restart the kolu server
    Then the connection status should eventually be "open"
    And the screen state should contain "kolu-survives-restart"
    And there should be no page errors

  Scenario: Git context re-resolves after a kolu-server restart
    Given the terminal is ready
    When I run "git init /tmp/kolu-reattach-git"
    And I run "cd /tmp/kolu-reattach-git"
    Then the header should show a branch name
    And the workspace switcher label should show "kolu-reattach-git"
    When I restart the kolu server
    Then the connection status should eventually be "open"
    And the header should show a branch name
    And the workspace switcher label should show "kolu-reattach-git"
    And there should be no page errors

  @claude-mock
  Scenario: Claude Code detection re-resolves after a kolu-server restart
    Given the terminal is ready
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When I restart the kolu server
    Then the connection status should eventually be "open"
    And the tile chrome should show an agent indicator with state "thinking"
    And there should be no page errors

  Scenario: Sub-terminal grouping survives a kolu-server restart
    Given the terminal is ready
    When I create a sub-terminal via command palette
    Then the active tile should show sub-terminal count 1
    When I restart the kolu server
    Then the connection status should eventually be "open"
    And the active tile should show sub-terminal count 1
    And there should be no page errors

  Scenario: A real idle shell shows no agent, before and after a restart
    Given the terminal is ready
    Then the tile chrome should not show an agent indicator
    When I restart the kolu server
    Then the connection status should eventually be "open"
    And the tile chrome should not show an agent indicator
    And there should be no page errors
